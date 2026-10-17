import { UserPayload } from "@/common/guards/auth.guard";
import { PrismaService } from "@/core/services/prisma/prisma.service";
import { StripeService } from "@/core/services/stripe/stripe.service";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
    ConfirmDeliveryDto,
    CreateOrderDto,
    DeliveryDto,
    OrderQueryDto,
    BuyerCancelOrderDto,
    BuyerCancelOrderItemDto,
    ProducerCancelOrderItemDto,
} from "./dto/body.dto";
import { ReportQueryDto } from "../admin/dto/body.dto";
import { ApiError } from "@/common/errors/api_error";
import Stripe from "stripe";
import QueryBuilder from "@/common/utils/queryBuilder";
import { BcryptService } from "@/common/utils/bcrypt.service";
import config from "@/config";
import { generateOrderId, generateOTP } from "../auth/auth.utils";
import { emailBodyForDeliveryCompletion } from "../auth/auth.template";
import sendEmail from "@/core/services/email";
import { PaymentQueueService } from "@/core/services/payment-queue/payment-queue.service";
import { background } from "@/common/utils/background";
import { NotificationService } from "../notification/notification.service";
import { SocketTrackingService } from "../socket/socket.tracking.service";
import { WebsocketGateway } from "../socket/socket.io.service";
import { StartTrackingDto, StopTrackingDto } from "./dto/tracking.dto";

const DELIVERY_CHARGE = 50;

@Injectable()
export class OrderService {
    constructor(
        private prisma: PrismaService,
        private bcryptService: BcryptService,
        private stripe: StripeService,
        private paymentQueue: PaymentQueueService,
        private notificationService: NotificationService,
        private socketTrackingService: SocketTrackingService,
        private websocketGateway: WebsocketGateway,
    ) { }

    async createOrder(user: UserPayload, payload: CreateOrderDto) {
        const shippingAddress =
            await this.prisma.shippingAddress.findUniqueOrThrow({
                where: {
                    id: payload.shippingAddressId,
                    userId: user.id,
                },
                select: {
                    id: true,
                },
            });

        const rawCartIds = payload.cartIds;

        const cartIds = Array.isArray(rawCartIds)
            ? Array.from(new Set(rawCartIds.filter(Boolean)))
            : [];

        if (cartIds.length === 0) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "At least one cart item is required to create an order",
            );
        }

        const carts = await this.prisma.cart.findMany({
            where: {
                userId: user.id,
                id: {
                    in: cartIds,
                },
            },
            select: {
                id: true,
                quantity: true,
                product: {
                    select: {
                        id: true,
                        name: true,
                        sellingUnit: true,
                        availableQuantity: true,
                        pricePerUnit: true,
                        pricingTiers: {
                            select: {
                                quantity: true,
                                pricePerUnit: true,
                            },
                            orderBy: {
                                quantity: "asc",
                            },
                        },
                    },
                },
            },
        });

        if (carts.length !== cartIds.length) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Some cart ids are invalid or do not belong to this user",
            );
        }

        const unavailableCart = carts.find(
            (cart) => cart.quantity > cart.product.availableQuantity,
        );

        if (unavailableCart) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                `Insufficient quantity available for ${unavailableCart.product.name}`,
            );
        }

        const items = carts.map((cart) => {
            const basePrice = cart.product.pricePerUnit as number;
            const applicableTier = cart.product.pricingTiers
                .filter((tier) => tier.quantity <= cart.quantity)
                .sort((a, b) => b.quantity - a.quantity)[0];

            const unitPrice = applicableTier
                ? (applicableTier.pricePerUnit as number)
                : basePrice;

            const subtotal = cart.quantity * unitPrice;

            return {
                productId: cart.product.id,
                quantity: cart.quantity,
                productName: cart.product.name,
                sellingUnit: cart.product.sellingUnit,
                unitPrice,
                subtotal,
            };
        });

        const totalAmount =
            Math.round(
                (items.reduce((total, item) => total + item.subtotal, 0) +
                    DELIVERY_CHARGE) *
                100,
            ) / 100;

        const orderId = generateOrderId();

        const order = await this.prisma.$transaction(async (transaction) => {
            const order = await transaction.order.create({
                data: {
                    orderId,
                    customerId: user.id,
                    shippingAddressId: shippingAddress.id,
                    status: "Pending",
                    totalAmount,
                    deliveryCharge: DELIVERY_CHARGE,
                    paymentStatus: "Pending",

                    items: {
                        create: items.map((item) => ({
                            productId: item.productId,
                            productName: item.productName,
                            sellingUnit: item.sellingUnit,
                            quantity: item.quantity,
                            unitPrice: item.unitPrice,
                            subtotal: item.subtotal,
                            status: "Pending",
                        })),
                    },
                },
            });

            return order;
        });

        const checkoutSession = await this.stripe.createCheckoutSession({
            line_items: [
                ...items.map((item) => ({
                    price_data: {
                        currency: "usd",

                        product_data: {
                            name: item.productName,
                            description: `Sold by ${item.sellingUnit}`,
                        },

                        unit_amount: Math.round(item.unitPrice * 100),
                    },

                    quantity: item.quantity,
                })),
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: "Delivery charge",
                            description: "Fixed delivery charge",
                        },
                        unit_amount: DELIVERY_CHARGE * 100,
                    },
                    quantity: 1,
                },
            ],

            client: {
                id: user.id,
                email: user.email,
            },

            metadata: {
                orderId: order.id,
                orderCode: orderId,
                customerId: user.id,
            },
        });

        return {
            message: "Order created successfully",
            orderId,
            checkoutSessionUrl: checkoutSession.url,
        };
    }

    async getUserOrders(user: UserPayload, query?: OrderQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.order, query);

        const response = queryBuilder
            .search(["orderId"])
            .filter({
                exacts: ["status", "paymentStatus"],
            })
            .rawFilter({
                customerId: user.id,
                paymentStatus: { in: ["Paid", "PartiallyRefunded", "Refunded"] },
            })
            .sortBy({
                createdAt: "desc",
            })
            .paginate()
            .select({
                id: true,
                orderId: true,
                status: true,
                paymentStatus: true,
                totalAmount: true,
                createdAt: true,
                items: {
                    select: {
                        id: true,
                        productName: true,
                        quantity: true,
                        unitPrice: true,
                        subtotal: true,
                        sellingUnit: true,
                        product: {
                            select: {
                                imageUrls: true,
                                producer: {
                                    select: {
                                        fullName: true,
                                        profileImage: true,
                                    },
                                },
                            },
                        },
                    },
                },
            });

        const [orders, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        return {
            message: "Orders fetched successfully",
            data: {
                orders,
                meta: pagination,
            },
        };
    }

    async getProducerWiseOrders(user: UserPayload, query?: OrderQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.orderItem, query);

        const response = queryBuilder
            .search(["productName"])
            .rawFilter({
                product: {
                    producerId: user.id,
                },
                order: {
                    paymentStatus: { in: ["Paid", "PartiallyRefunded", "Refunded"] },
                },
            })
            .select({
                id: true,
                productName: true,
                createdAt: true,
                sellingUnit: true,
                quantity: true,
                subtotal: true,
                unitPrice: true,
                status: true,
                product: {
                    select: {
                        imageUrls: true,
                    },
                },
                order: {
                    select: {
                        orderId: true,
                        customer: {
                            select: {
                                fullName: true,
                                profileImage: true,
                                city: true,
                                address: true,
                            },
                        },
                    },
                },
            });

        const [orderItems, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        return {
            message: "Orders fetched successfully",
            data: {
                orderItems,
                meta: pagination,
            },
        };
    }

    async getOrderItemDetailsForProducer(user: UserPayload, orderItemId: string) {
        const orderItem = await this.prisma.orderItem.findUniqueOrThrow({
            where: {
                id: orderItemId,
                product: {
                    producerId: user.id,
                },
            },
            select: {
                id: true,
                productName: true,
                createdAt: true,
                sellingUnit: true,
                quantity: true,
                subtotal: true,
                unitPrice: true,
                isReviewed: true,
                status: true,
                product: {
                    select: {
                        imageUrls: true,
                    },
                },
                review: {
                    select: {
                        id: true,
                        rating: true,
                        comment: true,
                        createdAt: true
                    },
                },
                report: {
                    select: {
                        id: true,
                        reason: true,
                        fileUrl: true,
                        status: true,
                        adminComment: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
                order: {
                    select: {
                        orderId: true,
                        customer: {
                            select: {
                                fullName: true,
                                profileImage: true,
                                city: true,
                                address: true,
                            },
                        },
                        deliveries: {
                            select: {
                                status: true,
                                createdAt: true,
                                updatedAt: true,
                                driver: {
                                    select: {
                                        fullName: true,
                                        address: true,
                                        profileImage: true,
                                        driverProfile: {
                                            select: {
                                                id: true,
                                                vehicleType: true,
                                                registrationNumber: true
                                            }
                                        }

                                    }
                                }
                            }
                        }
                    },
                },
            },
        });

        return {
            message: "Order item details fetched successfully",
            data: orderItem,
        };
    }

    async getProducerReports(user: UserPayload, query?: ReportQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.report, query);

        const response = queryBuilder
            .search(["orderItem.productName", "reason"])
            .filter({
                exacts: ["status"],
            })
            .rawFilter({
                orderItem: {
                    product: {
                        producerId: user.id,
                    },
                },
            })
            .sortBy({
                createdAt: "desc",
            })
            .paginate()
            .select({
                id: true,
                reason: true,
                fileUrl: true,
                status: true,
                adminComment: true,
                createdAt: true,
                updatedAt: true,
                buyer: {
                    select: {
                        fullName: true,
                        profileImage: true,
                    },
                },
                orderItem: {
                    select: {
                        id: true,
                        productName: true,
                        sellingUnit: true,
                        quantity: true,
                        subtotal: true,
                        unitPrice: true,
                        status: true,
                        order: {
                            select: {
                                id: true,
                                orderId: true,
                                createdAt: true,
                            },
                        },
                    },
                },
            });

        const [reports, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        return {
            message: "Producer reports fetched successfully",
            data: {
                reports,
                meta: pagination,
            },
        };
    }

    async getOrderById(user: UserPayload, orderId: string) {
        const order = await this.prisma.order.findUniqueOrThrow({
            where: {
                id: orderId,
                customerId: user.id,
            },
            select: {
                id: true,
                orderId: true,
                status: true,
                paymentStatus: true,
                totalAmount: true,
                cancelReason: true,
                shippingAddress: {
                    select: {
                        addressLine: true,
                        city: true,
                        instruction: true,
                        postCode: true,
                    },
                },
                deliveries: {
                    include: {
                        driver: {
                            select: {
                                id: true,
                                fullName: true,
                                phoneNumber: true,
                                profileImage: true,
                                driverProfile: {
                                    select: {
                                        vehicleType: true,
                                        registrationNumber: true,
                                    },
                                },
                            },
                        },
                    },
                },
                createdAt: true,
                updatedAt: true,
                items: {
                    select: {
                        id: true,
                        productName: true,
                        quantity: true,
                        unitPrice: true,
                        subtotal: true,
                        isReviewed: true,
                        sellingUnit: true,
                        status: true,
                        createdAt: true,
                        updatedAt: true,
                        report: {
                            select: {
                                id: true,
                                reason: true,
                                fileUrl: true,
                                status: true,
                                adminComment: true,
                                createdAt: true,
                                updatedAt: true,
                            },
                        },
                        product: {
                            select: {
                                imageUrls: true,
                                producer: {
                                    select: {
                                        fullName: true,
                                        profileImage: true,
                                        address: true,
                                        city: true,
                                        producerProfile: {
                                            select: {
                                                farmName: true,
                                                farmSize: true,
                                                producerType: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        return {
            message: "Order fetched successfully",
            data: order,
        };
    }

    async markOrderItemSentToHub(orderItemId: string, user: UserPayload) {
        await this.prisma.orderItem.findUniqueOrThrow({
            where: {
                id: orderItemId,
                product: {
                    producerId: user.id,
                },
                status: "Pending",
            },
            select: {
                id: true,
                status: true,
            },
        });

        await this.prisma.orderItem.update({
            where: {
                id: orderItemId,
            },
            data: {
                status: "SentToHub",
            },
        });

        background.add(async () => {
            const admin = await this.prisma.user.findFirst({
                where: {
                    role: "ADMIN",
                },
                select: {
                    id: true,
                },
            });
            await this.notificationService.createNotification({
                receiverId: admin.id,
                title: "New Order Item Sent to Hub",
                content:
                    "A new order item has been sent to hub. Please review and approve the order item.",
                notificationType: "Profile",
            });
        });

        return {
            message: "Order item marked as sent to hub successfully",
        };
    }

    async getDriverWiseDeliveries(user: UserPayload) {
        const deliveries = await this.prisma.delivery.findMany({
            where: { driverId: user.id },
            select: {
                id: true,
                status: true,
                otpHash: true,
                order: {
                    select: {
                        orderId: true,
                        totalAmount: true,
                        shippingAddress: {
                            select: {
                                city: true,
                            },
                        },
                        customer: {
                            select: {
                                fullName: true,
                            },
                        },
                        _count: {
                            select: {
                                items: true
                            },
                        },
                    },
                },
            },
        });

        return {
            message: "Deliveries fetched successfully",
            data: deliveries,
        };
    }

    async getDriverDeliveryDetails(deliveryId: string, user: UserPayload) {
        const delivery = await this.prisma.delivery.findUniqueOrThrow({
            where: {
                id: deliveryId,
                driverId: user.id,
            },
            select: {
                id: true,
                status: true,
                otpHash: true,
                startLatitude: true,
                startLongitude: true,
                latitude: true,
                longitude: true,
                heading: true,
                speed: true,
                isTracking: true,
                trackingStartedAt: true,
                trackingUpdatedAt: true,
                order: {
                    select: {
                        id: true,
                        orderId: true,
                        totalAmount: true,
                        status: true,
                        shippingAddress: {
                            select: {
                                id: true,
                                addressLine: true,
                                city: true,
                                instruction: true,
                                postCode: true,
                            },
                        },
                        customer: {
                            select: {
                                id: true,
                                fullName: true,
                                phoneNumber: true,
                                profileImage: true,
                            },
                        },
                        items: {
                            select: {
                                productName: true,
                                subtotal: true,
                                unitPrice: true,
                                quantity: true,
                                sellingUnit: true,
                            },
                        },
                    },
                },
            },
        });

        return {
            message: "Delivery details fetched successfully",
            data: delivery,
        };
    }

    async getDeliveryTrackingSnapshot(deliveryId: string, user: UserPayload) {
        const snapshot = await this.socketTrackingService.getTrackingSnapshot(deliveryId, user.id);
        return {
            message: "Live tracking snapshot fetched successfully",
            data: snapshot,
        };
    }

    async startDeliveryTracking(payload: StartTrackingDto, user: UserPayload) {
        const result = await this.socketTrackingService.startTracking(payload.deliveryId, user.id, {
            latitude: payload.latitude,
            longitude: payload.longitude,
            heading: payload.heading,
            speed: payload.speed,
        });

        this.websocketGateway.notifyDeliveryStatusChanged(
            payload.deliveryId,
            result.status,
            true,
        );

        return {
            message: "Live tracking started successfully",
            data: result,
        };
    }

    async stopDeliveryTracking(payload: StopTrackingDto, user: UserPayload) {
        const result = await this.socketTrackingService.stopTracking(payload.deliveryId, user.id);

        this.websocketGateway.notifyDeliveryStatusChanged(
            payload.deliveryId,
            result.status,
            false,
        );

        return {
            message: "Live tracking stopped successfully",
            data: result,
        };
    }

    async markDeliveryAsPickedUpOrCanceled(
        payload: DeliveryDto,
        user: UserPayload,
    ) {
        await this.prisma.delivery.findUniqueOrThrow({
            where: {
                id: payload.deliveryId,
                driverId: user.id,
                status: "Assigned",
            },
            select: {
                id: true,
            },
        });

        if (payload.status === "PickedUp") {
            const delivery = await this.prisma.delivery.update({
                where: {
                    id: payload.deliveryId,
                },
                data: {
                    status: "PickedUp",
                },
                select: {
                    orderId: true,
                },
            });

            await this.prisma.order.update({
                where: {
                    id: delivery.orderId,
                },
                data: {
                    status: "Shipped",
                },
            });

            this.websocketGateway.notifyDeliveryStatusChanged(payload.deliveryId, "PickedUp", false);

            return {
                message: "Delivery marked as picked up successfully",
            };
        } else if (payload.status === "Cancelled") {
            await this.prisma.$transaction([
                this.prisma.delivery.delete({
                    where: {
                        id: payload.deliveryId,
                    },
                }),
                this.prisma.driverProfile.updateMany({
                    where: {
                        userId: user.id,
                    },
                    data: {
                        isAvailable: true,
                    },
                }),
            ]);

            this.websocketGateway.notifyDeliveryStatusChanged(payload.deliveryId, "Cancelled", false);

            return {
                message: "Delivery cancelled successfully",
            };
        }
    }

    async sendDeliveryCompletionOtp(deliveryId: string, user: UserPayload) {
        const delivery = await this.prisma.delivery.findUniqueOrThrow({
            where: {
                id: deliveryId,
                driverId: user.id,
                status: "PickedUp",
            },
            select: {
                id: true,
                order: {
                    select: {
                        orderId: true,
                        customer: {
                            select: {
                                email: true,
                            },
                        },
                    },
                },
            },
        });

        const { otp } = generateOTP();

        const hashedOtp: string = await this.bcryptService.hash(
            otp,
            config.password.salt,
        );

        const html = emailBodyForDeliveryCompletion(
            delivery.order.orderId,
            otp,
        );
        await sendEmail(
            delivery.order.customer.email,
            `Your OTP for Delivery Completion - Order ${delivery.order.orderId}`,
            html,
        );

        await this.prisma.delivery.update({
            where: {
                id: deliveryId,
            },
            data: {
                otpHash: hashedOtp,
            },
        });

        return {
            message: "OTP sent to customer successfully",
        };
    }

    async verifyDeliveryCompletionOtp(
        payload: ConfirmDeliveryDto,
        user: UserPayload,
    ) {
        const delivery = await this.prisma.delivery.findUniqueOrThrow({
            where: {
                id: payload.deliveryId,
                driverId: user.id,
                status: "PickedUp",
            },
            select: {
                id: true,
                otpHash: true,
                order: {
                    select: {
                        id: true,
                        status: true,
                        paymentStatus: true,
                        deliveryCharge: true,
                        items: {
                            select: {
                                id: true,
                                status: true,
                                subtotal: true,
                                product: {
                                    select: {
                                        producerId: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!delivery.otpHash) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Delivery OTP has not been sent yet. Please tap 'Send OTP' first.",
            );
        }

        const otpMatched = await this.bcryptService.compare(
            payload.otp,
            delivery.otpHash as string,
        );

        if (!otpMatched) {
            throw new ApiError(HttpStatus.FORBIDDEN, "Incorrect OTP");
        }

        const earnings = await this.prisma.$transaction(
            async (transaction) => {
                await Promise.all([
                    transaction.delivery.update({
                        where: {
                            id: payload.deliveryId,
                        },
                        data: {
                            status: "Delivered",
                            isTracking: false,
                            trackingUpdatedAt: new Date(),
                        },
                    }),
                    transaction.driverProfile.update({
                        where: {
                            userId: user.id,
                        },
                        data: {
                            isAvailable: true,
                        },
                    }),
                    transaction.order.update({
                        where: {
                            id: delivery.order.id,
                        },
                        data: {
                            status: "Delivered",
                        },
                    }),
                ]);

                const validItems = delivery.order.items.filter(
                    (item) => item.status !== "Cancelled" && item.status !== "Refunded",
                );

                const producerEarnings = await Promise.all(
                    validItems.map(async (item) => {
                        await transaction.orderItem.update({
                            where: {
                                id: item.id,
                            },
                            data: {
                                status: "Delivered",
                            },
                        });
                        return transaction.producerEarning.create({
                            data: {
                                producerId: item.product.producerId,
                                orderItemId: item.id,
                                amount: item.subtotal * 0.9, // Assuming 10% platform fee
                            },
                        });
                    }),
                );

                const driverEarning = await transaction.driverEarning.create({
                    data: {
                        driverId: user.id,
                        orderId: delivery.order.id,
                        amount: delivery.order.deliveryCharge,
                    },
                });

                return { producerEarnings, driverEarning };
            },
            {
                maxWait: 10000,
                timeout: 30000,
            },
        );

        try {
            await Promise.all([
                ...earnings.producerEarnings.map((earning) =>
                    this.paymentQueue.scheduleProducerTransfer(earning.id),
                ),
                this.paymentQueue.scheduleDriverTransfer(earnings.driverEarning.id),
            ]);
        } catch (queueError) {
            console.error(
                "Warning: Failed to enqueue payment queue transfer jobs:",
                queueError,
            );
        }

        this.websocketGateway.notifyDeliveryStatusChanged(payload.deliveryId, "Delivered", false);

        return {
            message: "Delivery marked as completed successfully",
        };
    }

    //stripe webhook handler

    async handleStripeWebhook(
        payload: string | Buffer<ArrayBufferLike>,
        signature: string,
    ) {
        console.log("Came here:", payload.toString());
        const event = await this.stripe.constructEvent(payload, signature);

        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;

                if (session.payment_status === "paid") {
                    await this.markOrderAsPaid(session);
                }
                break;
            }
            case "checkout.session.async_payment_succeeded":
                await this.markOrderAsPaid(
                    event.data.object as Stripe.Checkout.Session,
                );
                break;
            case "checkout.session.async_payment_failed":
            case "checkout.session.expired":
                await this.markOrderAsFailed(
                    event.data.object as Stripe.Checkout.Session,
                );
                break;
            default:
                break;
        }

        return { received: true };
    }

    private async markOrderAsPaid(session: Stripe.Checkout.Session) {
        const orderId = session.metadata?.orderId;

        if (!orderId) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Stripe checkout session is missing order metadata",
            );
        }

        const paymentIntentId =
            typeof session.payment_intent === "string"
                ? session.payment_intent
                : undefined;

        try {
            await this.prisma.$transaction(async (transaction) => {
                const order = await transaction.order.findUnique({
                    where: { id: orderId },
                    include: { items: true },
                });

                if (
                    !order ||
                    order.paymentStatus === "Paid" ||
                    order.paymentStatus === "Refunded" ||
                    order.paymentStatus === "Failed"
                ) {
                    return;
                }

                await transaction.order.update({
                    where: { id: order.id },
                    data: {
                        status: "Active",
                        paymentStatus: "Paid",
                        ...(paymentIntentId
                            ? { stripePaymentIntentId: paymentIntentId }
                            : {}),
                    },
                });

                for (const item of order.items) {
                    const result = await transaction.product.updateMany({
                        where: {
                            id: item.productId,
                            availableQuantity: {
                                gte: item.quantity,
                            },
                        },
                        data: {
                            availableQuantity: {
                                decrement: item.quantity,
                            },
                        },
                    });

                    if (result.count === 0) {
                        throw new ApiError(
                            HttpStatus.BAD_REQUEST,
                            `Insufficient quantity available for ${item.productName}`,
                        );
                    }
                }

                await transaction.cart.deleteMany({
                    where: {
                        userId: order.customerId,
                        productId: {
                            in: order.items.map((item) => item.productId),
                        },
                    },
                });
            });
        } catch (processingError) {
            if (!paymentIntentId) {
                await this.prisma.order.updateMany({
                    where: { id: orderId },
                    data: {
                        status: "Cancelled",
                        paymentStatus: "Failed",
                        cancelReason: "Payment processing failed",
                    },
                });

                throw processingError;
            }

            try {
                await this.stripe.refundPaymentIntent(
                    paymentIntentId,
                    `order-refund-${orderId}`,
                );

                await this.prisma.$transaction([
                    this.prisma.order.update({
                        where: { id: orderId },
                        data: {
                            status: "Refunded",
                            paymentStatus: "Refunded",
                            stripePaymentIntentId: paymentIntentId,
                            cancelReason:
                                "Payment refunded because order processing failed",
                        },
                    }),
                    this.prisma.orderItem.updateMany({
                        where: { orderId },
                        data: { status: "Refunded" },
                    }),
                ]);
            } catch (refundError) {
                await this.prisma.order.updateMany({
                    where: { id: orderId },
                    data: {
                        status: "Cancelled",
                        paymentStatus: "Failed",
                        stripePaymentIntentId: paymentIntentId,
                        cancelReason: "Payment refund failed",
                    },
                });

                throw refundError;
            }
        }
    }

    private async markOrderAsFailed(session: Stripe.Checkout.Session) {
        const orderId = session.metadata?.orderId;

        if (!orderId) {
            return;
        }

        await this.prisma.order.updateMany({
            where: {
                id: orderId,
                paymentStatus: "Pending",
            },
            data: {
                status: "Cancelled",
                paymentStatus: "Failed",
            },
        });
    }

    async buyerCancelOrder(
        user: UserPayload,
        orderId: string,
        payload: BuyerCancelOrderDto,
    ) {
        const order = await this.prisma.order.findUnique({
            where: {
                id: orderId,
                customerId: user.id,
            },
            include: {
                items: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                producerId: true,
                            },
                        },
                    },
                },
            },
        });

        if (!order) {
            throw new ApiError(HttpStatus.NOT_FOUND, "Order not found");
        }

        if (order.status === "Cancelled" || order.status === "Refunded") {
            throw new ApiError(HttpStatus.BAD_REQUEST, "Order is already cancelled or refunded");
        }

        if (order.status === "Delivered") {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Delivered orders cannot be cancelled. You may submit a quality dispute within 24 hours.",
            );
        }

        if (order.status === "Shipped") {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Order is already out for delivery and cannot be cancelled.",
            );
        }

        // Check if any active item has already been sent to hub
        const sentToHubItem = order.items.find(
            (item) => item.status === "SentToHub" || item.status === "Delivered",
        );
        if (sentToHubItem) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                `Cannot cancel order because "${sentToHubItem.productName}" has already arrived at the aggregation hub. Please contact support.`,
            );
        }

        const activeItems = order.items.filter((item) => item.status !== "Cancelled");
        if (activeItems.length === 0) {
            throw new ApiError(HttpStatus.BAD_REQUEST, "All items in this order are already cancelled");
        }

        // If paid via Stripe, process refund
        if (
            (order.paymentStatus === "Paid" || order.paymentStatus === "PartiallyRefunded") &&
            order.stripePaymentIntentId
        ) {
            try {
                await this.stripe.refundPaymentIntent(
                    order.stripePaymentIntentId,
                    `buyer-cancel-order-${order.id}-${Date.now()}`,
                );
            } catch (stripeErr) {
                console.error("Stripe refund error during buyer cancel order:", stripeErr);
                throw new ApiError(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to process refund with payment gateway. Please try again or contact support.",
                );
            }
        }

        await this.prisma.$transaction(async (tx) => {
            // Restore inventory for active items
            for (const item of activeItems) {
                await tx.product.update({
                    where: { id: item.productId },
                    data: {
                        availableQuantity: {
                            increment: item.quantity,
                        },
                    },
                });
            }

            // Update order
            await tx.order.update({
                where: { id: order.id },
                data: {
                    status: "Cancelled",
                    paymentStatus: order.paymentStatus === "Paid" || order.paymentStatus === "PartiallyRefunded" ? "Refunded" : order.paymentStatus,
                    cancelReason: payload.reason,
                },
            });

            // Update all active items
            await tx.orderItem.updateMany({
                where: {
                    orderId: order.id,
                    status: { not: "Cancelled" },
                },
                data: {
                    status: "Cancelled",
                    cancelReason: payload.reason,
                },
            });
        });

        // Notifications
        background.add(async () => {
            await this.notificationService.createNotification({
                receiverId: user.id,
                title: "Order Cancelled",
                content: `Your order #${order.orderId} has been successfully cancelled. ${order.paymentStatus === "Paid" || order.paymentStatus === "PartiallyRefunded" ? "Your full refund has been issued." : ""}`,
                notificationType: "Order",
            });

            const producerIds = Array.from(new Set(activeItems.map((it) => it.product.producerId)));
            for (const producerId of producerIds) {
                await this.notificationService.createNotification({
                    receiverId: producerId,
                    title: "Order Item Cancelled by Buyer",
                    content: `An item in order #${order.orderId} was cancelled by the buyer. Reserved inventory has been restored.`,
                    notificationType: "Order",
                });
            }
        });

        return {
            message: "Order cancelled and refund processed successfully",
        };
    }

    async buyerCancelOrderItem(
        user: UserPayload,
        orderItemId: string,
        payload: BuyerCancelOrderItemDto,
    ) {
        const item = await this.prisma.orderItem.findUnique({
            where: { id: orderItemId },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        producerId: true,
                    },
                },
                order: {
                    include: {
                        items: true,
                    },
                },
            },
        });

        if (!item || item.order.customerId !== user.id) {
            throw new ApiError(HttpStatus.NOT_FOUND, "Order item not found");
        }

        if (item.status === "Cancelled" || item.status === "Refunded") {
            throw new ApiError(HttpStatus.BAD_REQUEST, "Item is already cancelled or refunded");
        }

        if (item.status === "SentToHub" || item.status === "Delivered") {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                `Cannot cancel "${item.productName}" because it has already reached the aggregation hub.`,
            );
        }

        if (item.order.status === "Shipped" || item.order.status === "Delivered") {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Order is already shipped or delivered; individual items cannot be cancelled.",
            );
        }

        const remainingActiveItems = item.order.items.filter(
            (it) => it.id !== item.id && it.status !== "Cancelled",
        );
        const isLastItem = remainingActiveItems.length === 0;

        const refundAmount = isLastItem
            ? Math.round((item.subtotal + (item.order.deliveryCharge || 50)) * 100) / 100
            : item.subtotal;

        if (
            (item.order.paymentStatus === "Paid" || item.order.paymentStatus === "PartiallyRefunded") &&
            item.order.stripePaymentIntentId
        ) {
            try {
                await this.stripe.refundPaymentIntent(
                    item.order.stripePaymentIntentId,
                    `buyer-cancel-item-${item.id}-${Date.now()}`,
                    refundAmount,
                );
            } catch (stripeErr) {
                console.error("Stripe refund error during buyer cancel item:", stripeErr);
                throw new ApiError(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to process refund with payment gateway. Please try again or contact support.",
                );
            }
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.product.update({
                where: { id: item.productId },
                data: {
                    availableQuantity: {
                        increment: item.quantity,
                    },
                },
            });

            await tx.orderItem.update({
                where: { id: item.id },
                data: {
                    status: "Cancelled",
                    cancelReason: payload.reason,
                },
            });

            if (isLastItem) {
                const deliveries = await tx.delivery.findMany({
                    where: { orderId: item.orderId },
                });
                for (const del of deliveries) {
                    await tx.driverProfile.updateMany({
                        where: { userId: del.driverId },
                        data: { isAvailable: true },
                    });
                }
                await tx.delivery.deleteMany({
                    where: { orderId: item.orderId },
                });
            }

            await tx.order.update({
                where: { id: item.orderId },
                data: {
                    status: isLastItem ? "Cancelled" : "PartiallyCancelled",
                    paymentStatus: isLastItem ? "Refunded" : "PartiallyRefunded",
                    ...(isLastItem ? { cancelReason: payload.reason } : {}),
                },
            });
        });

        background.add(async () => {
            await this.notificationService.createNotification({
                receiverId: user.id,
                title: "Item Cancelled",
                content: `Your item "${item.productName}" from order #${item.order.orderId} has been cancelled. Refund of $${refundAmount} has been processed.`,
                notificationType: "Order",
            });

            await this.notificationService.createNotification({
                receiverId: item.product.producerId,
                title: "Order Item Cancelled",
                content: `Buyer cancelled "${item.productName}" from order #${item.order.orderId}. Inventory has been restored.`,
                notificationType: "Order",
            });
        });

        return {
            message: `Item "${item.productName}" cancelled successfully`,
        };
    }

    async producerCancelOrderItem(
        user: UserPayload,
        orderItemId: string,
        payload: ProducerCancelOrderItemDto,
    ) {
        const item = await this.prisma.orderItem.findUnique({
            where: { id: orderItemId },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        producerId: true,
                    },
                },
                order: {
                    include: {
                        items: true,
                    },
                },
            },
        });

        if (!item || item.product.producerId !== user.id) {
            throw new ApiError(
                HttpStatus.FORBIDDEN,
                "You do not have permission to cancel this order item",
            );
        }

        if (item.status === "Cancelled" || item.status === "Refunded") {
            throw new ApiError(HttpStatus.BAD_REQUEST, "Item is already cancelled or refunded");
        }

        if (item.status === "SentToHub" || item.status === "Delivered") {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                `Cannot cancel "${item.productName}" because it has already been sent to the hub or delivered.`,
            );
        }

        const remainingActiveItems = item.order.items.filter(
            (it) => it.id !== item.id && it.status !== "Cancelled",
        );
        const isLastItem = remainingActiveItems.length === 0;

        const refundAmount = isLastItem
            ? Math.round((item.subtotal + (item.order.deliveryCharge || 50)) * 100) / 100
            : item.subtotal;

        if (
            (item.order.paymentStatus === "Paid" || item.order.paymentStatus === "PartiallyRefunded") &&
            item.order.stripePaymentIntentId
        ) {
            try {
                await this.stripe.refundPaymentIntent(
                    item.order.stripePaymentIntentId,
                    `producer-cancel-item-${item.id}-${Date.now()}`,
                    refundAmount,
                );
            } catch (stripeErr) {
                console.error("Stripe refund error during producer cancel item:", stripeErr);
                throw new ApiError(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to process refund with payment gateway. Please contact admin.",
                );
            }
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.orderItem.update({
                where: { id: item.id },
                data: {
                    status: "Cancelled",
                    cancelReason: payload.reason,
                },
            });

            if (isLastItem) {
                const deliveries = await tx.delivery.findMany({
                    where: { orderId: item.orderId },
                });
                for (const del of deliveries) {
                    await tx.driverProfile.updateMany({
                        where: { userId: del.driverId },
                        data: { isAvailable: true },
                    });
                }
                await tx.delivery.deleteMany({
                    where: { orderId: item.orderId },
                });
            }

            await tx.order.update({
                where: { id: item.orderId },
                data: {
                    status: isLastItem ? "Cancelled" : "PartiallyCancelled",
                    paymentStatus: isLastItem ? "Refunded" : "PartiallyRefunded",
                    ...(isLastItem ? { cancelReason: `Producer cancelled: ${payload.reason}` } : {}),
                },
            });
        });

        background.add(async () => {
            await this.notificationService.createNotification({
                receiverId: item.order.customerId,
                title: "Item Unavailable - Refund Issued",
                content: `The producer was unable to fulfill "${item.productName}" in order #${item.order.orderId} (${payload.reason}). An automatic refund of $${refundAmount} has been sent to your payment method.`,
                notificationType: "Order",
            });

            await this.notificationService.createNotification({
                receiverId: user.id,
                title: "Item Cancellation Confirmed",
                content: `You cancelled item "${item.productName}" for order #${item.order.orderId}. Customer was refunded $${refundAmount}.`,
                notificationType: "Order",
            });
        });

        return {
            message: `Item "${item.productName}" cancelled and customer refunded $${refundAmount} successfully`,
        };
    }
}


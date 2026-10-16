import QueryBuilder from "@/common/utils/queryBuilder";
import { PrismaService } from "@/core/services/prisma/prisma.service";
import { BadRequestException, HttpStatus, Injectable } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import {
    AcceptRejectAccountDto,
    CategoryDto,
    DriverQueryDto,
    ProducerQueryDto,
    AssignDriverDto,
    BaseUserQueryDto,
    EarningQueryDto,
    ReportQueryDto,
    ResolveReportDto,
} from "./dto/body.dto";
import { ApiError } from "@/common/errors/api_error";
import { FileService } from "@/core/services/files/cloudinary.service";
import { OrderQueryDto } from "../order/dto/body.dto";
import { StripeService } from "@/core/services/stripe/stripe.service";
import { background } from "@/common/utils/background";
import { NotificationService } from "../notification/notification.service";

@Injectable()
export class AdminService {
    constructor(
        private prisma: PrismaService,
        private fileService: FileService,
        private stripe: StripeService,
        private notificationService: NotificationService,
    ) { }

    async getAllProducerFromDB(query: ProducerQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.user, query);

        const response = queryBuilder
            .search(["email", "fullName"])
            .filter({
                exacts: ["verificationStatus", "producerType"],
                nestedFields: {
                    verificationStatus: "producerProfile.verificationStatus",
                    producerType: "producerProfile.producerType",
                },
            })
            .rawFilter({
                role: {
                    equals: UserRole.PRODUCER,
                },
            })
            .sort()
            .paginate()
            .select({
                id: true,
                fullName: true,
                email: true,
                profileImage: true,
                producerProfile: {
                    omit: {
                        updatedAt: true,
                        userId: true,
                    },
                },
            });

        const [allProducer, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        return {
            data: {
                producers: allProducer,
                meta: pagination,
            },
            message: "All producer fetched successfully",
        };
    }

    async getProducerDetailsFromDB(producerId: string) {
        const producer = await this.prisma.user.findUniqueOrThrow({
            where: {
                id: producerId,
                role: UserRole.PRODUCER,
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                profileImage: true,
                address: true,
                city: true,
                region: true,
                phoneNumber: true,
                producerProfile: {
                    omit: {
                        userId: true,
                        updatedAt: true,
                        stripeAccountId: true,
                    },
                },
                products: {
                    select: {
                        id: true,
                        name: true,
                        imageUrls: true,
                        availableQuantity: true,
                        avgRating: true,
                        totalReviews: true,
                        pricePerUnit: true,
                        sellingUnit: true,
                        sold: true,
                        description: true,
                        reviews: {
                            select: {
                                rating: true,
                                comment: true,
                                createdAt: true,
                                buyer: {
                                    select: {
                                        fullName: true,
                                        profileImage: true,
                                    },
                                },
                            },
                        },
                        category: {
                            select: {
                                name: true,
                            },
                        },
                        _count: {
                            select: {
                                orderItems: true,
                            },
                        },
                        pricingTiers: {
                            select: {
                                quantity: true,
                                pricePerUnit: true,
                            },
                        },
                        orderItems: {
                            select: {
                                quantity: true,
                                subtotal: true,
                                unitPrice: true,
                                status: true,
                            },
                        },
                    },
                },
                producerEarnings: {
                    select: {
                        amount: true,
                        isTransferred: true,
                        paidAt: true,
                        createdAt: true,
                        orderItem: {
                            select: {
                                productName: true,
                                sellingUnit: true,
                                quantity: true,
                            },
                        },
                    },
                },
            },
        });

        return {
            data: {
                producer,
            },
            message: "Producer details fetched successfully",
        };
    }

    async acceptRejectProducerAccount(payload: AcceptRejectAccountDto) {
        await this.prisma.producerProfile.findUniqueOrThrow({
            where: {
                userId: payload.accountId,
                verificationStatus: "Pending",
            },
        });

        if (!payload.isAccept && !payload.rejectReason) {
            throw new ApiError(
                HttpStatus.FORBIDDEN,
                "Reject reason is required",
            );
        }

        await this.prisma.producerProfile.update({
            where: { userId: payload.accountId },
            data: {
                verificationStatus: payload.isAccept ? "Accepted" : "Rejected",
                rejectionReason: payload.rejectReason,
            },
        });

        background.add(async () => {
            await this.notificationService.createNotification({
                receiverId: payload.accountId,
                title: `Your producer profile has been ${payload.isAccept ? "Accepted" : "Rejected"}`,
                content:
                    `Your producer profile has been ${payload.isAccept ? "Accepted" : "Rejected"} by the admin. Please review and approve the profile.`,
                notificationType: "Profile",
            });
        });

        return {
            message: `${payload.isAccept ? "Accepted" : "Rejected"} producer account successfully`,
        };
    }

    async getAllDriverFromDB(query: DriverQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.user, query);

        const response = queryBuilder
            .search(["email", "fullName"])
            .filter({
                exacts: ["vehicleType", "verificationStatus"],
                nestedFields: {
                    vehicleType: "driverProfile.vehicleType",
                    verificationStatus: "driverProfile.verificationStatus",
                },
            })
            .rawFilter({
                role: {
                    equals: UserRole.DRIVER,
                },
            })
            .sort()
            .paginate()
            .select({
                id: true,
                fullName: true,
                email: true,
                profileImage: true,
                driverProfile: {
                    omit: {
                        updatedAt: true,
                        userId: true,
                    },
                },
            });

        const [allDriver, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        return {
            data: {
                drivers: allDriver,
                meta: pagination,
            },
            message: "All driver fetched successfully",
        };
    }

    async getDriverDetailsFromDB(driverId: string) {
        const driver = await this.prisma.user.findUniqueOrThrow({
            where: {
                id: driverId,
                role: UserRole.DRIVER,
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                profileImage: true,
                city: true,
                address: true,
                region: true,
                phoneNumber: true,
                status: true,
                driverProfile: {
                    omit: {
                        userId: true,
                        updatedAt: true,
                        stripeAccountId: true,
                    },
                },
                deliveries: {
                    select: {
                        id: true,
                        status: true,
                        order: {
                            select: {
                                orderId: true,
                                totalAmount: true,
                                shippingAddress: {
                                    select: {
                                        addressLine: true,
                                        city: true,
                                        postCode: true,
                                        instruction: true,
                                    },
                                },
                                items: {
                                    select: {
                                        productName: true,
                                        sellingUnit: true,
                                        quantity: true,
                                        subtotal: true,
                                        unitPrice: true,
                                    },
                                },
                            },
                        },
                    },
                },
                driverEarnings: {
                    select: {
                        amount: true,
                        isTransferred: true,
                        paidAt: true,
                        createdAt: true,
                        order: {
                            select: {
                                orderId: true,
                                deliveryCharge: true,
                            },
                        },
                    },
                },
            },
        });

        return {
            message: "Driver details fetched successfully",
            data: {
                driver,
            },
        };
    }

    async acceptRejectDriverAccount(payload: AcceptRejectAccountDto) {
        await this.prisma.driverProfile.findUniqueOrThrow({
            where: {
                userId: payload.accountId,
                verificationStatus: "Pending",
            },
        });

        if (!payload.isAccept && !payload.rejectReason) {
            throw new ApiError(
                HttpStatus.FORBIDDEN,
                "Reject reason is required",
            );
        }

        await this.prisma.driverProfile.update({
            where: { userId: payload.accountId },
            data: {
                verificationStatus: payload.isAccept ? "Accepted" : "Rejected",
                rejectionReason: payload.isAccept ? null : payload.rejectReason,
            },
        });

        background.add(async () => {
            await this.notificationService.createNotification({
                receiverId: payload.accountId,
                title: `Your driver profile has been ${payload.isAccept ? "Accepted" : "Rejected"}`,
                content:
                    `Your driver profile has been ${payload.isAccept ? "Accepted" : "Rejected"} by the admin.`,
                notificationType: "Profile",
            });
        });


        return {
            message: `${payload.isAccept ? "Accepted" : "Rejected"} driver account successfully`,
        };
    }

    async getAllBuyerFromDB(query: BaseUserQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.user, query);

        const response = queryBuilder
            .search(["email", "fullName"])
            .rawFilter({
                role: {
                    equals: UserRole.BUYER,
                },
            })
            .sort()
            .paginate()
            .select({
                id: true,
                fullName: true,
                email: true,
                city: true,
                address: true,
                region: true,
                profileImage: true,
                status: true,
                phoneNumber: true,
                _count: {
                    select: {
                        orders: true,
                    },
                },
            });

        const [allBuyer, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        return {
            data: {
                buyers: allBuyer,
                meta: pagination,
            },
            message: "All buyer fetched successfully",
        };
    }

    async getBuyerDetailsFromDB(buyerId: string) {
        const buyer = await this.prisma.user.findUniqueOrThrow({
            where: {
                id: buyerId,
                role: UserRole.BUYER,
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                profileImage: true,
                city: true,
                address: true,
                region: true,
                phoneNumber: true,
                status: true,
                shippingAddresses: {
                    omit: {
                        createdAt: true,
                        updatedAt: true,
                        userId: true,
                        id: true,
                    },
                },
                orders: {
                    select: {
                        id: true,
                        status: true,
                        totalAmount: true,
                        createdAt: true,
                        items: {
                            select: {
                                productName: true,
                                sellingUnit: true,
                                quantity: true,
                                subtotal: true,
                                unitPrice: true,
                            },
                        },
                    },
                },
            },
        });

        return {
            data: {
                buyer,
            },
            message: "Buyer details fetched successfully",
        };
    }

    async createNewCategory(payload: CategoryDto, file?: Express.Multer.File) {
        const existingCategory = await this.prisma.category.findUnique({
            where: {
                slug: payload.slug,
            },
            select: {
                slug: true,
            },
        });

        if (existingCategory) {
            throw new ApiError(HttpStatus.CONFLICT, "Category already exists");
        }

        let imageUrl = null;
        if (file) {
            imageUrl = await this.fileService.uploadToCloudinary(file);
        }

        if (!imageUrl) {
            throw new ApiError(HttpStatus.BAD_REQUEST, "Image upload failed");
        }

        await this.prisma.category.create({
            data: {
                ...payload,
                imageUrl,
            },
        });

        return {
            message: "Category created successfully",
        };
    }

    async getAllCategories() {
        const categories = await this.prisma.category.findMany({
            select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                imageUrl: true,
                isActive: true,
            },
        });

        return {
            message: "All categories fetched successfully",
            data: {
                categories,
            },
        };
    }

    async toggleCategoryStatus(categoryId: string) {
        const category = await this.prisma.category.findUniqueOrThrow({
            where: {
                id: categoryId,
            },
            select: {
                id: true,
                isActive: true,
            },
        });

        await this.prisma.category.update({
            where: {
                id: categoryId,
            },
            data: {
                isActive: !category.isActive,
            },
        });

        return {
            message: `Category ${category.isActive ? "Deactived" : "Actived"} successfully`,
        };
    }

    async toggleProductFeatured(productId: string) {
        const product = await this.prisma.product.findUniqueOrThrow({
            where: {
                id: productId,
            },
            select: {
                id: true,
                isFeatured: true,
            },
        });

        const updated = await this.prisma.product.update({
            where: {
                id: productId,
            },
            data: {
                isFeatured: !product.isFeatured,
            },
            select: {
                id: true,
                isFeatured: true,
            },
        });

        return {
            message: `Product ${updated.isFeatured ? "marked as featured" : "removed from featured"} successfully`,
            data: updated,
        };
    }


    async getAllOrdersFromDB(query: OrderQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.order, query);

        const response = queryBuilder
            .search(["product.name", "orderId"])
            .filter({
                exacts: ["status"],
            })
            .rawFilter({
                paymentStatus: "Paid",
            })
            .sort()
            .paginate()
            .select({
                id: true,
                totalAmount: true,
                deliveryCharge: true,
                status: true,
                paymentStatus: true,
                createdAt: true,
                orderId: true,
                _count: {
                    select: {
                        items: true,
                    },
                },
                customer: {
                    select: {
                        fullName: true,
                        profileImage: true,
                    },
                },
                deliveries: {
                    select: {
                        id: true,
                        status: true,
                    },
                },
                shippingAddress: {
                    select: {
                        addressLine: true,
                        city: true,
                    },
                },
            });

        const [allOrders, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        return {
            data: {
                orders: allOrders,
                meta: pagination,
            },
            message: "All orders fetched successfully",
        };
    }

    async assignDriverToDelivery(payload: AssignDriverDto) {
        const [order, driver] = await Promise.all([
            this.prisma.order.findUnique({
                where: {
                    id: payload.orderId,
                    status: "Active",
                    paymentStatus: "Paid",

                },
                select: {
                    customerId:true,
                    orderId:true,
                    deliveries: {
                        select: {
                            id: true,
                            status: true,
                        },
                    },
                    items: {
                        select: {
                            status: true,
                        },
                    },
                },
            }),
            this.prisma.user.findUnique({
                where: {
                    id: payload.driverId,
                    role: UserRole.DRIVER,
                },
                select: {
                    id: true,
                    driverProfile: {
                        select: {
                            verificationStatus: true,
                            isAvailable: true,
                        },
                    },
                },
            }),
        ]);

        if (!order) {
            throw new ApiError(
                HttpStatus.NOT_FOUND,
                "Order not found or not eligible for delivery",
            );
        }

        if (
            order.items.length === 0 ||
            order.items.some((item) => item.status !== "SentToHub")
        ) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "All order items must arrive at the hub before assigning a driver",
            );
        }

        if (order.deliveries.length > 0) {
            throw new ApiError(
                HttpStatus.CONFLICT,
                "Driver already assigned to this order",
            );
        }

        if (!driver) {
            throw new ApiError(HttpStatus.NOT_FOUND, "Driver not found");
        }

        if (driver.driverProfile.verificationStatus !== "Accepted") {
            throw new ApiError(HttpStatus.FORBIDDEN, "Driver is not verified");
        }

        if (!driver.driverProfile.isAvailable) {
            throw new ApiError(HttpStatus.FORBIDDEN, "Driver is not available");
        }

        await this.prisma.$transaction(async (tx) => {
            const driver = await tx.driverProfile.updateMany({
                where: {
                    userId: payload.driverId,
                },
                data: {
                    isAvailable: false,
                },
            });

            if (driver.count === 0) {
                throw new BadRequestException("Driver is no longer available");
            }

            await tx.delivery.create({
                data: {
                    orderId: payload.orderId,
                    driverId: payload.driverId,
                },
            });
        });

        background.add(async () => {
            await this.notificationService.createNotification({
                receiverId: payload.driverId,
                title: `New Delivery Assigned`,
                content: `New delivery assigned to you by the admin. Please review the details and accept the delivery.`,
                notificationType: "Order",
            });

            await this.notificationService.createNotification({
                receiverId: order.customerId,
                title: `Driver Assigned`,
                content: `Driver assigned in order ${order.orderId}. Review the details and track your delivery.`,
                notificationType: "Order",
            });


        });


        return {
            message: "Driver assigned to delivery successfully",
        };
    }

    async getOrderDetailsFromDB(orderId: string) {
        const order = await this.prisma.order.findUniqueOrThrow({
            where: {
                id: orderId,
            },
            select: {
                id: true,
                orderId: true,
                totalAmount: true,
                deliveryCharge: true,
                status: true,
                paymentStatus: true,
                stripePaymentIntentId: true,
                cancelReason: true,
                createdAt: true,
                updatedAt: true,
                customer: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phoneNumber: true,
                        profileImage: true,
                        city: true,
                        address: true,
                        region: true,
                    },
                },
                shippingAddress: {
                    select: {
                        id: true,
                        addressLine: true,
                        city: true,
                        postCode: true,
                        instruction: true,
                    },
                },
                deliveries: {
                    select: {
                        id: true,
                        status: true,
                        startLatitude: true,
                        startLongitude: true,
                        latitude: true,
                        longitude: true,
                        heading: true,
                        speed: true,
                        isTracking: true,
                        trackingStartedAt: true,
                        trackingUpdatedAt: true,
                        createdAt: true,
                        updatedAt: true,
                        driver: {
                            select: {
                                id: true,
                                fullName: true,
                                email: true,
                                phoneNumber: true,
                                profileImage: true,
                                driverProfile: {
                                    select: {
                                        vehicleType: true,
                                        registrationNumber: true,
                                        drivingLicenseUrl: true,
                                        isAvailable: true,
                                    },
                                },
                            },
                        },
                    },
                },
                items: {
                    select: {
                        id: true,
                        productName: true,
                        sellingUnit: true,
                        quantity: true,
                        unitPrice: true,
                        subtotal: true,
                        status: true,
                        cancelReason: true,
                        isReviewed: true,
                        createdAt: true,
                        product: {
                            select: {
                                id: true,
                                name: true,
                                imageUrls: true,
                                description: true,
                                category: {
                                    select: {
                                        name: true,
                                    },
                                },
                                producer: {
                                    select: {
                                        id: true,
                                        fullName: true,
                                        email: true,
                                        phoneNumber: true,
                                        profileImage: true,
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
                        producerEarning: {
                            select: {
                                amount: true,
                                isTransferred: true,
                                paidAt: true,
                            },
                        },
                        review: {
                            select: {
                                rating: true,
                                comment: true,
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
                            },
                        },
                    },
                },
                driverEarning: {
                    select: {
                        amount: true,
                        isTransferred: true,
                        paidAt: true,
                    },
                },
            },
        });

        return {
            data: {
                order,
            },
            message: "Order details fetched successfully",
        };
    }

    async getAllProducerEarnings(query: EarningQueryDto) {
        const queryBuilder = new QueryBuilder(
            this.prisma.producerEarning,
            query,
        );

        const response = queryBuilder
            .search(["orderItem.productName"])
            .filter({
                booleans: ["isTransferred"],
            })
            .sort()
            .paginate()
            .select({
                id: true,
                amount: true,
                isTransferred: true,
                paidAt: true,
                createdAt: true,
                producer: {
                    select: {
                        id: true,
                        fullName: true,
                        profileImage: true,
                        producerProfile: {
                            select: {
                                farmName: true,
                            },
                        },
                    },
                },
                orderItem: {
                    select: {
                        productName: true,
                        sellingUnit: true,
                        quantity: true,
                        subtotal: true,
                    },
                },
            });

        const [allEarnings, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        return {
            message: "All producer earnings fetched successfully",
            data: {
                earnings: allEarnings,
                meta: pagination,
            },
        };
    }

    async getAllDriverEarnings(query: EarningQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.driverEarning, query);

        const response = queryBuilder
            .search(["order.orderId"])
            .filter({
                booleans: ["isTransferred"],
            })
            .sort()
            .paginate()
            .select({
                id: true,
                amount: true,
                isTransferred: true,
                paidAt: true,
                createdAt: true,
                driver: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        profileImage: true,
                        driverProfile: {
                            select: {
                                vehicleType: true,
                            },
                        },
                    },
                },
                order: {
                    select: {
                        orderId: true,
                        totalAmount: true,
                        items: {
                            select: {
                                productName: true,
                                sellingUnit: true,
                                quantity: true,
                                subtotal: true,
                                unitPrice: true,
                            },
                        },
                    },
                },
            });

        const [allEarnings, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        return {
            message: "All driver earnings fetched successfully",
            data: {
                earnings: allEarnings,
                meta: pagination,
            },
        };
    }

    async transferProducerEarningManually(earningId: string) {
        const earning = await this.prisma.producerEarning.findUnique({
            where: {
                id: earningId,
            },
            select: {
                id: true,
                producerId: true,
                orderItemId: true,
                createdAt: true,
                amount: true,
                isTransferred: true,
            },
        });

        if (!earning) {
            throw new ApiError(
                HttpStatus.NOT_FOUND,
                "Producer earning record not found",
            );
        }

        if (earning.isTransferred) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Earning has already been transferred",
            );
        }

        if (earning.createdAt.getTime() + 24 * 60 * 60 * 1000 > Date.now()) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Please wait for 24 hours to transfer the earning",
            );
        }

        const unsolvedReport = await this.prisma.report.findFirst({
            where: {
                orderItemId: earning.orderItemId,
                status: "Pending",
            },
            select: {
                id: true,
            },
        });

        if (unsolvedReport) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Please resolve the report before transferring the earning",
            );
        }

        const producer = await this.prisma.producerProfile.findUnique({
            where: {
                userId: earning.producerId,
            },
            select: {
                stripeAccountId: true,
            },
        });

        if (!producer || !producer.stripeAccountId) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Producer stripe account not found",
            );
        }

        if (!earning.amount || earning.amount <= 0) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Invalid earning amount to transfer",
            );
        }

        const transfer = await this.stripe.createTransfer({
            amount: earning.amount,
            destination: producer.stripeAccountId,
            idempotencyKey: `producer-earning-${earning.id}`,
        });

        await this.prisma.producerEarning.update({
            where: {
                id: earningId,
            },
            data: {
                isTransferred: true,
                stripeTransferId: transfer.id,
                paidAt: new Date(),
            },
        });

        return {
            message: "Earning transferred successfully",
        };
    }

    async transferDriverEarningManually(earningId: string) {
        const earning = await this.prisma.driverEarning.findUnique({
            where: {
                id: earningId,
            },
            select: {
                id: true,
                driverId: true,
                orderId: true,
                createdAt: true,
                amount: true,
                isTransferred: true,
            },
        });

        if (!earning) {
            throw new ApiError(
                HttpStatus.NOT_FOUND,
                "Driver earning record not found",
            );
        }

        if (earning.isTransferred) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Earning has already been transferred",
            );
        }

        if (earning.createdAt.getTime() + 24 * 60 * 60 * 1000 > Date.now()) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Please wait for 24 hours to transfer the earning",
            );
        }

        const unsolvedReport = await this.prisma.report.findFirst({
            where: {
                orderItem: {
                    orderId: earning.orderId,
                },
                status: "Pending",
            },
            select: {
                id: true,
            },
        });

        if (unsolvedReport) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Please resolve the report before transferring the earning",
            );
        }

        const driver = await this.prisma.driverProfile.findUnique({
            where: {
                userId: earning.driverId,
            },
            select: {
                stripeAccountId: true,
            },
        });

        if (!driver || !driver.stripeAccountId) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Driver stripe account not found",
            );
        }

        if (!earning.amount || earning.amount <= 0) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Invalid earning amount to transfer",
            );
        }

        const transfer = await this.stripe.createTransfer({
            amount: earning.amount,
            destination: driver.stripeAccountId,
            idempotencyKey: `driver-earning-${earning.id}`,
        });

        await this.prisma.driverEarning.update({
            where: {
                id: earningId,
            },
            data: {
                isTransferred: true,
                stripeTransferId: transfer.id,
                paidAt: new Date(),
            },
        });

        return {
            message: "Driver earning transferred successfully",
        };
    }

    async getAllReportsFromDB(query: ReportQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.report, query);

        const response = queryBuilder
            .search([
                "reason",
                "buyer.fullName",
                "buyer.email",
                "orderItem.productName",
            ])
            .filter({
                exacts: ["status"],
            })
            .sort()
            .paginate()
            .select({
                id: true,
                reason: true,
                fileUrl: true,
                adminComment: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                buyer: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phoneNumber: true,
                        profileImage: true,
                    },
                },
                orderItem: {
                    select: {
                        id: true,
                        productName: true,
                        sellingUnit: true,
                        quantity: true,
                        unitPrice: true,
                        subtotal: true,
                        status: true,
                        order: {
                            select: {
                                id: true,
                                orderId: true,
                                status: true,
                                paymentStatus: true,
                                totalAmount: true,
                                createdAt: true,
                            },
                        },
                        product: {
                            select: {
                                id: true,
                                name: true,
                                imageUrls: true,
                                producer: {
                                    select: {
                                        id: true,
                                        fullName: true,
                                        email: true,
                                        phoneNumber: true,
                                        profileImage: true,
                                        producerProfile: {
                                            select: {
                                                farmName: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        producerEarning: {
                            select: {
                                id: true,
                                amount: true,
                                isTransferred: true,
                                paidAt: true,
                            },
                        },
                    },
                },
            });

        const [allReports, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        return {
            message: "All reports fetched successfully",
            data: {
                reports: allReports,
                meta: pagination,
            },
        };
    }

    async getReportDetailsFromDB(reportId: string) {
        const report = await this.prisma.report.findUniqueOrThrow({
            where: { id: reportId },
            select: {
                id: true,
                reason: true,
                fileUrl: true,
                adminComment: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                buyer: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phoneNumber: true,
                        profileImage: true,
                        address: true,
                        city: true,
                    },
                },
                orderItem: {
                    select: {
                        id: true,
                        productName: true,
                        sellingUnit: true,
                        quantity: true,
                        unitPrice: true,
                        subtotal: true,
                        status: true,
                        order: {
                            select: {
                                id: true,
                                orderId: true,
                                status: true,
                                paymentStatus: true,
                                totalAmount: true,
                                createdAt: true,
                                shippingAddress: {
                                    select: {
                                        addressLine: true,
                                        city: true,
                                        postCode: true,
                                    },
                                },
                            },
                        },
                        product: {
                            select: {
                                id: true,
                                name: true,
                                imageUrls: true,
                                producer: {
                                    select: {
                                        id: true,
                                        fullName: true,
                                        email: true,
                                        phoneNumber: true,
                                        profileImage: true,
                                        producerProfile: {
                                            select: {
                                                farmName: true,
                                                farmLocation: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        producerEarning: {
                            select: {
                                id: true,
                                amount: true,
                                isTransferred: true,
                                paidAt: true,
                            },
                        },
                    },
                },
            },
        });

        return {
            message: "Report details fetched successfully",
            data: {
                report,
            },
        };
    }

    async resolveOrRejectReport(
        reportId: string,
        payload: ResolveReportDto,
    ) {
        const report = await this.prisma.report.findUnique({
            where: { id: reportId },
            include: {
                orderItem: {
                    include: {
                        order: {
                            include: {
                                items: true,
                            },
                        },
                        producerEarning: true,
                    },
                },
            },
        });

        if (!report) {
            throw new ApiError(HttpStatus.NOT_FOUND, "Report not found");
        }

        if (report.status !== "Pending") {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                `Report has already been ${report.status.toLowerCase()}`,
            );
        }

        if (payload.status === "Resolved") {
            await this.prisma.$transaction(async (tx) => {
                await tx.report.update({
                    where: { id: reportId },
                    data: {
                        status: "Resolved",
                        adminComment: payload.adminComment,
                    },
                });

                await tx.orderItem.update({
                    where: { id: report.orderItemId },
                    data: {
                        status: "Refunded",
                    },
                });

                const otherItems = report.orderItem.order.items.filter(
                    (it) => it.id !== report.orderItemId,
                );
                const allRefundedOrCancelled =
                    otherItems.length === 0 ||
                    otherItems.every(
                        (it) =>
                            it.status === "Refunded" ||
                            it.status === "Cancelled",
                    );
                    console.log("allRefundedOrCancelled", allRefundedOrCancelled);

                // await tx.order.update({
                //     where: { id: report.orderItem.orderId },
                //     data: {
                //         paymentStatus: allRefundedOrCancelled
                //             ? "Refunded"
                //             : "PartiallyRefunded",
                //         status: allRefundedOrCancelled ? "Refunded" : undefined,
                //     },
                // });
            });

            if (report.orderItem.order.stripePaymentIntentId) {
                try {
                    await this.stripe.refundPaymentIntent(
                        report.orderItem.order.stripePaymentIntentId,
                        `report-refund-${report.id}`,
                    );
                } catch (stripeErr) {
                    console.error("Warning: Stripe refund skipped or already processed:", stripeErr);
                }
            }

            return {
                message: "Report resolved and item marked as refunded successfully",
            };
        } else if (payload.status === "Rejected") {
            await this.prisma.report.update({
                where: { id: reportId },
                data: {
                    status: "Rejected",
                    adminComment: payload.adminComment,
                },
            });

            return {
                message: "Report rejected and claim dismissed successfully",
            };
        } else {
            throw new ApiError(HttpStatus.BAD_REQUEST, "Invalid report status");
        }
    }
}

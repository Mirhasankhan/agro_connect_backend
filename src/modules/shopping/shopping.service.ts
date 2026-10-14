import { UserPayload } from "@/common/guards/auth.guard";
import { ApiError } from "@/common/errors/api_error";
import { PrismaService } from "@/core/services/prisma/prisma.service";
import { HttpStatus, Injectable } from "@nestjs/common";
import { CartDto, UpdateCartDto } from "./dto/body.dto";

@Injectable()
export class ShoppingService {
    constructor(private prisma: PrismaService) {}

    async addProductToCart(user: UserPayload, payload: CartDto) {
        const product = await this.prisma.product.findUniqueOrThrow({
            where: {
                id: payload.productId,
            },
            select: {
                id: true,
                availableQuantity: true,
            },
        });

        const existingCart = await this.prisma.cart.findUnique({
            where: {
                userId_productId: {
                    userId: user.id,
                    productId: payload.productId,
                },
            },
            select: {
                id: true,
                quantity: true,
            },
        });

        const totalQuantity = (existingCart?.quantity ?? 0) + payload.quantity;
        if (totalQuantity > product.availableQuantity) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                `Only ${product.availableQuantity} units of this product are available`,
            );
        }

        if (existingCart) {
            await this.prisma.cart.update({
                where: {
                    id: existingCart.id,
                },
                data: {
                    quantity: {
                        increment: payload.quantity,
                    },
                },
            });

            return {
                message: "Product added to cart successfully",
            };
        }

        await this.prisma.cart.create({
            data: {
                userId: user.id,
                productId: payload.productId,
                quantity: payload.quantity,
            },
        });

        return {
            message: "Product added to cart successfully",
        };
    }

    async getUserCartItems(user: UserPayload) {
        const cartItems = await this.prisma.cart.findMany({
            where: {
                userId: user.id,
            },
            select: {
                id: true,
                quantity: true,
                product: {
                    select: {
                        id: true,
                        name: true,
                        pricePerUnit: true,
                        imageUrls: true,
                        sellingUnit: true,
                        availableQuantity: true,
                        pricingTiers: {
                            select: {
                                id: true,
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

        return {
            message: "Cart items retrieved successfully",
            data: cartItems,
        };
    }

    async updateCartItemQuantity(user: UserPayload, payload: UpdateCartDto) {
        const cartItem = await this.prisma.cart.findFirstOrThrow({
            where: {
                id: payload.cartId,
                userId: user.id,
            },
            select: {
                id: true,
                quantity: true,
                product: {
                    select: {
                        availableQuantity: true,
                    },
                },
            },
        });

        if (payload.increment) {
            const updatedCart = await this.prisma.cart.updateMany({
                where: {
                    id: payload.cartId,
                    userId: user.id,
                    quantity: {
                        lt: cartItem.product.availableQuantity,
                    },
                },
                data: {
                    quantity: {
                        increment: 1,
                    },
                },
            });

            if (updatedCart.count === 0) {
                throw new ApiError(
                    HttpStatus.BAD_REQUEST,
                    `Only ${cartItem.product.availableQuantity} units of this product are available`,
                );
            }

            return {
                message: "Cart item quantity increased successfully",
            };
        }

        if (cartItem.quantity <= 1) {
            throw new ApiError(
                HttpStatus.BAD_REQUEST,
                "Quantity cannot be less than 1",
            );
        }

        await this.prisma.cart.updateMany({
            where: {
                id: payload.cartId,
                userId: user.id,
                quantity: {
                    gt: 1,
                },
            },
            data: {
                quantity: {
                    decrement: 1,
                },
            },
        });

        return {
            message: "Cart item quantity decreased successfully",
        };
    }

    async removeProductFromCart(user: UserPayload, cartId: string) {
        await this.prisma.cart.delete({
            where: {
                id: cartId,
                userId: user.id,
            },
        });

        return {
            message: "Product removed from cart successfully",
        };
    }

    //wishlist related methods will be added here in future

    async addRemoveProductToWishlist(user: UserPayload, productId: string) {
        await this.prisma.product.findUniqueOrThrow({
            where: {
                id: productId,
            },
            select: {
                id: true,
            },
        });

        const existingWishlist = await this.prisma.wishlist.findUnique({
            where: {
                userId_productId: {
                    userId: user.id,
                    productId,
                },
            },
            select: {
                id: true,
            },
        });

        if (existingWishlist) {
            await this.prisma.wishlist.delete({
                where: {
                    id: existingWishlist.id,
                },
            });

            return {
                message: "Product removed from wishlist successfully",
            };
        }

        await this.prisma.wishlist.create({
            data: {
                userId: user.id,
                productId,
            },
        });

        return {
            message: "Product added to wishlist successfully",
        };
    }

    async getUserWishlistItems(user: UserPayload) {
        const wishlistItems = await this.prisma.wishlist.findMany({
            where: {
                userId: user.id,
            },
            select: {
                id: true,
                productId: true,
                createdAt: true,
                product: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        pricePerUnit: true,
                        imageUrls: true,
                        sellingUnit: true,
                        availableQuantity: true,
                        category: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                        producer: {
                            select: {
                                fullName: true,
                                producerProfile: {
                                    select: {
                                        farmName: true,
                                        companyName: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        return {
            message: "Wishlist items retrieved successfully",
            data: wishlistItems,
        };
    }

    async getTopRatedProducers() {
        const ratedProducts = await this.prisma.product.findMany({
            where: {
                avgRating: {
                    gt: 0,
                },
                producer: {
                    role: "PRODUCER",
                },
            },
            select: {
                producerId: true,
                avgRating: true,
                producer: {
                    select: {
                        fullName: true,
                        profileImage: true,
                        producerProfile: {
                            select: {
                                farmName: true,
                                farmLocation: true,
                                farmPhotoUrl: true,
                            },
                        },
                        _count: {
                            select: {
                                products: true,
                            },
                        },
                    },
                },
            },
        });

        const producerRatings = new Map<
            string,
            {
                fullName: string;
                profileImage: string | null;
                farmName: string | null;
                farmLocation: string | null;
                farmPhotoUrl: string | null;
                totalProductCount: number;
                ratingTotal: number;
                ratedProductCount: number;
            }
        >();

        for (const product of ratedProducts) {
            const existing = producerRatings.get(product.producerId);
            if (existing) {
                existing.ratingTotal += product.avgRating;
                existing.ratedProductCount += 1;
                continue;
            }

            producerRatings.set(product.producerId, {
                fullName: product.producer.fullName,
                profileImage: product.producer.profileImage,
                farmName: product.producer.producerProfile?.farmName ?? null,
                farmLocation: product.producer.producerProfile?.farmLocation ?? null,
                farmPhotoUrl: product.producer.producerProfile?.farmPhotoUrl ?? null,
                totalProductCount: product.producer._count.products,
                ratingTotal: product.avgRating,
                ratedProductCount: 1,
            });
        }

        const topRatedProducers = [...producerRatings.entries()]
            .map(([producerId, producer]) => ({
                producerId,
                ...producer,
                avgRating: producer.ratingTotal / producer.ratedProductCount,
            }))
            .sort((first, second) => second.avgRating - first.avgRating)
            .slice(0, 4);

        const producerIds = topRatedProducers.map(({ producerId }) => producerId);
        const orderItems = producerIds.length
            ? await this.prisma.orderItem.findMany({
                  where: {
                      product: {
                          producerId: {
                              in: producerIds,
                          },
                      },
                  },
                  select: {
                      orderId: true,
                      product: {
                          select: {
                              producerId: true,
                          },
                      },
                  },
              })
            : [];

        const ordersByProducer = new Map<string, Set<string>>();
        for (const orderItem of orderItems) {
            const producerOrders =
                ordersByProducer.get(orderItem.product.producerId) ?? new Set<string>();
            producerOrders.add(orderItem.orderId);
            ordersByProducer.set(orderItem.product.producerId, producerOrders);
        }

        return {
            message: "Top rated producers retrieved successfully",
            data: topRatedProducers.map(
                ({
                    producerId,
                    fullName,
                    profileImage,
                    farmName,
                    farmLocation,
                    farmPhotoUrl,
                    totalProductCount,
                    avgRating,
                }) => ({
                    producerId,
                    fullName,
                    profileImage,
                    farmName,
                    farmLocation,
                    farmPhotoUrl,
                    totalOrders: ordersByProducer.get(producerId)?.size ?? 0,
                    avgRating,
                    totalProductCount,
                }),
            ),
        };
    }

}

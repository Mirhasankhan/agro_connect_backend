import { PrismaService } from "@/core/services/prisma/prisma.service";
import { BadRequestException, Injectable } from "@nestjs/common";
import { UserPayload } from "@/common/guards/auth.guard";
import QueryBuilder from "@/common/utils/queryBuilder";
import { PaymentQueryDto } from "./dto/body.dto";
import { StripeService } from "@/core/services/stripe/stripe.service";
import { UserRole } from "@prisma/client";
import config from "@/config";

@Injectable()
export class PaymentService {
    constructor(
        private prisma: PrismaService,
        private stripeService: StripeService,
    ) {}

    async getProducerWisePayments(user: UserPayload, query: PaymentQueryDto) {
        const queryBuilder = new QueryBuilder(
            this.prisma.producerEarning,
            query,
        );

        const response = queryBuilder
            .search(["orderItem.productName"])
            .filter({
                booleans: ["isTransferred"],
            })
            .rawFilter({ producerId: user.id })
            .paginate()
            .sortBy({ createdAt: "desc" })
            .select({
                id: true,
                amount: true,
                isTransferred: true,
                createdAt: true,
                paidAt: true,
                orderItem: {
                    select: {
                        productName: true,
                        quantity: true,
                        sellingUnit: true,
                        unitPrice: true,
                        subtotal: true,
                        report: {
                            select: {
                                id: true,
                                status: true,
                                reason: true,
                                adminComment: true,
                            },
                        },
                    },
                },
            });

        const [payments, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        const earningSummary = await this.prisma.producerEarning.aggregate({
            where: { producerId: user.id },
            _sum: {
                amount: true,
            },
        });

        return {
            message: "Producer wise payments fetched successfully",
            data: {
                payments,
                pagination,
                earningSummary: earningSummary._sum,
            },
        };
    }

    async getDriverWisePayments(user: UserPayload, query: PaymentQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.driverEarning, query);

        const response = queryBuilder
            .search(["order.orderId"])
            .filter({
                booleans: ["isTransferred"],
            })
            .rawFilter({ driverId: user.id })
            .paginate()
            .sortBy({ createdAt: "desc" })
            .select({
                id: true,
                amount: true,
                isTransferred: true,
                createdAt: true,
                paidAt: true,
                order: {
                    select: {
                        id: true,
                        orderId: true,
                        items: {
                            select: {
                                productName: true,
                                quantity: true,
                                sellingUnit: true,
                                unitPrice: true,
                                subtotal: true,
                            },
                        },
                    },
                },
            });

        const [payments, pagination] = await Promise.all([
            response.execute(),
            response.countTotal(),
        ]);

        const earningSummary = await this.prisma.driverEarning.aggregate({
            where: { driverId: user.id },
            _sum: {
                amount: true,
            },
        });

        return {
            message: "Driver wise payments fetched successfully",
            data: {
                payments,
                pagination,
                earningSummary: earningSummary._sum,
            },
        };
    }

    async getProducerEarningChart(user: UserPayload, type: string) {
        if (type !== "monthly" && type !== "weekly") {
            throw new BadRequestException(
                "Type must be either monthly or weekly",
            );
        }

        const now = new Date();
        const monthNames = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        ];
        const dayNames = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
        const startDate = new Date(now);

        if (type === "monthly") {
            startDate.setMonth(0, 1);
            startDate.setHours(0, 0, 0, 0);
        } else {
            const daysSinceSaturday = (now.getDay() + 1) % 7;
            startDate.setDate(now.getDate() - daysSinceSaturday);
            startDate.setHours(0, 0, 0, 0);
        }

        const producerEarnings = await this.prisma.producerEarning.findMany({
            where: {
                producerId: user.id,
                createdAt: { gte: startDate },
            },
            select: {
                amount: true,
                createdAt: true,
            },
        });

        const summary =
            type === "monthly"
                ? monthNames.map((month, index) => ({
                      month,
                      earning: producerEarnings
                          .filter(
                              ({ createdAt }) =>
                                  createdAt.getFullYear() ===
                                      now.getFullYear() &&
                                  createdAt.getMonth() === index,
                          )
                          .reduce((total, { amount }) => total + amount, 0),
                  }))
                : dayNames.map((day, index) => ({
                      day,
                      earning: producerEarnings
                          .filter(({ createdAt }) => {
                              const daysSinceSaturday =
                                  (createdAt.getDay() + 1) % 7;
                              return daysSinceSaturday === index;
                          })
                          .reduce((total, { amount }) => total + amount, 0),
                  }));

        return {
            message: "Producer earning chart fetched successfully",
            data: summary,
        };
    }

    async getDriverEarningChart(user: UserPayload, type: string) {
        if (type !== "monthly" && type !== "weekly") {
            throw new BadRequestException(
                "Type must be either monthly or weekly",
            );
        }

        const now = new Date();
        const monthNames = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        ];
        const dayNames = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
        const startDate = new Date(now);

        if (type === "monthly") {
            startDate.setMonth(0, 1);
            startDate.setHours(0, 0, 0, 0);
        } else {
            const daysSinceSaturday = (now.getDay() + 1) % 7;
            startDate.setDate(now.getDate() - daysSinceSaturday);
            startDate.setHours(0, 0, 0, 0);
        }

        const driverEarnings = await this.prisma.driverEarning.findMany({
            where: {
                driverId: user.id,
                createdAt: { gte: startDate },
            },
            select: {
                amount: true,
                createdAt: true,
            },
        });

        const summary =
            type === "monthly"
                ? monthNames.map((month, index) => ({
                      month,
                      earning: driverEarnings
                          .filter(
                              ({ createdAt }) =>
                                  createdAt.getFullYear() ===
                                      now.getFullYear() &&
                                  createdAt.getMonth() === index,
                          )
                          .reduce((total, { amount }) => total + amount, 0),
                  }))
                : dayNames.map((day, index) => ({
                      day,
                      earning: driverEarnings
                          .filter(({ createdAt }) => {
                              const daysSinceSaturday =
                                  (createdAt.getDay() + 1) % 7;
                              return daysSinceSaturday === index;
                          })
                          .reduce((total, { amount }) => total + amount, 0),
                  }));

        return {
            message: "Driver earning chart fetched successfully",
            data: summary,
        };
    }

    async getStripeAccountStatus(user: UserPayload) {
        let stripeAccountId: string | null = null;

        if (user.role === UserRole.PRODUCER) {
            const profile = await this.prisma.producerProfile.findUnique({
                where: { userId: user.id },
                select: { stripeAccountId: true },
            });
            stripeAccountId = profile?.stripeAccountId || null;
        } else if (user.role === UserRole.DRIVER) {
            const profile = await this.prisma.driverProfile.findUnique({
                where: { userId: user.id },
                select: { stripeAccountId: true },
            });
            stripeAccountId = profile?.stripeAccountId || null;
        } else {
            throw new BadRequestException("Role not supported for stripe payouts");
        }

        if (!stripeAccountId) {
            return {
                message: "Stripe account status fetched successfully",
                data: {
                    hasStripeAccount: false,
                    stripeAccountId: null,
                    detailsSubmitted: false,
                    payoutsEnabled: false,
                    chargesEnabled: false,
                    isEnabled: false,
                },
            };
        }

        const status = await this.stripeService.getAccountStatus(stripeAccountId);

        return {
            message: "Stripe account status fetched successfully",
            data: {
                hasStripeAccount: true,
                ...status,
            },
        };
    }

    async connectStripe(user: UserPayload, clientReturnUrl?: string) {
        const fullUser = await this.prisma.user.findUniqueOrThrow({
            where: { id: user.id },
            select: { id: true, email: true, fullName: true, role: true },
        });

        let stripeAccountId: string | null = null;
        let defaultReturnUrl = clientReturnUrl;

        if (user.role === UserRole.PRODUCER) {
            const profile = await this.prisma.producerProfile.findUnique({
                where: { userId: user.id },
            });
            if (!profile) {
                throw new BadRequestException("Producer profile not found");
            }

            if (!profile.stripeAccountId) {
                const businessType =
                    profile.producerType === "Company" ? "company" : "individual";
                const account = await this.stripeService.createConnectAccount({
                    email: fullUser.email,
                    businessType,
                });

                await this.prisma.producerProfile.update({
                    where: { userId: user.id },
                    data: { stripeAccountId: account.id },
                });

                stripeAccountId = account.id;
            } else {
                stripeAccountId = profile.stripeAccountId;
            }

            if (!defaultReturnUrl) {
                defaultReturnUrl = `${config.url.frontend || "http://localhost:3000"}/producer/earnings`;
            }
        } else if (user.role === UserRole.DRIVER) {
            const profile = await this.prisma.driverProfile.findUnique({
                where: { userId: user.id },
            });
            if (!profile) {
                throw new BadRequestException("Driver profile not found");
            }

            if (!profile.stripeAccountId) {
                const account = await this.stripeService.createConnectAccount({
                    email: fullUser.email,
                    businessType: "individual",
                });

                await this.prisma.driverProfile.update({
                    where: { userId: user.id },
                    data: { stripeAccountId: account.id },
                });

                stripeAccountId = account.id;
            } else {
                stripeAccountId = profile.stripeAccountId;
            }

            if (!defaultReturnUrl) {
                defaultReturnUrl = `${config.url.frontend || "http://localhost:3000"}/driver/earnings`;
            }
        } else {
            throw new BadRequestException("Role not supported for stripe payouts");
        }

        const cleanReturn = defaultReturnUrl.split("?")[0];
        const refreshUrl = `${cleanReturn}?stripe_connect=refresh`;
        const returnUrl = `${cleanReturn}?stripe_connect=complete`;

        const status = await this.stripeService.getAccountStatus(stripeAccountId);

        if (status.isEnabled) {
            try {
                const loginLink =
                    await this.stripeService.createAccountLoginLink(stripeAccountId);
                return {
                    message: "Stripe dashboard link generated successfully",
                    data: {
                        url: loginLink.url,
                        stripeAccountId,
                        alreadyEnabled: true,
                    },
                };
            } catch {
                // Fallback to onboarding link
            }
        }

        const accountLink = await this.stripeService.createAccountLink({
            accountId: stripeAccountId,
            refreshUrl,
            returnUrl,
        });

        return {
            message: "Stripe onboarding link generated successfully",
            data: {
                url: accountLink.url,
                stripeAccountId,
                alreadyEnabled: false,
            },
        };
    }
}

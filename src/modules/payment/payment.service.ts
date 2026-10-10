import { PrismaService } from "@/core/services/prisma/prisma.service";
import { BadRequestException, Injectable } from "@nestjs/common";
import { UserPayload } from "@/common/guards/auth.guard";
import QueryBuilder from "@/common/utils/queryBuilder";
import { PaymentQueryDto } from "./dto/body.dto";

@Injectable()
export class PaymentService {
    constructor(private prisma: PrismaService) {}

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
}

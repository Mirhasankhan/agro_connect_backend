import { PrismaService } from "@/core/services/prisma/prisma.service";
import { Injectable, HttpStatus } from "@nestjs/common";
import { UserPayload } from "@/common/guards/auth.guard";
import { CreateReportDto, CreateReviewDto } from "./dto/body.dto";
import { ApiError } from "@/common/errors/api_error";
import { PaymentQueueService } from "@/core/services/payment-queue/payment-queue.service";

@Injectable()
export class FeedbackService {
    constructor(
        private prisma: PrismaService,
        private paymentQueue: PaymentQueueService,
    ) {}

    async submitReport(user: UserPayload, payload: CreateReportDto) {
        const report = await this.prisma.$transaction(async (tx) => {
            const orderItem = await tx.orderItem.findUnique({
                where: {
                    id: payload.orderItemId,
                    order: { customerId: user.id, status: "Delivered" },
                },
                select: {
                    id: true,
                    orderId: true,
                    status: true,
                    updatedAt: true,
                    report: { select: { id: true } },
                    producerEarning: { select: { id: true, createdAt: true } },
                },
            });

            if (!orderItem) {
                throw new ApiError(
                    HttpStatus.BAD_REQUEST,
                    "Invalid order item or order is not delivered",
                );
            }

            if (orderItem.report) {
                throw new ApiError(
                    HttpStatus.BAD_REQUEST,
                    "A report has already been submitted for this order item",
                );
            }

            const deliveryTime =
                orderItem.producerEarning?.createdAt || orderItem.updatedAt;
            const diffHours =
                (Date.now() - new Date(deliveryTime).getTime()) /
                (1000 * 60 * 60);

            if (diffHours > 24) {
                throw new ApiError(
                    HttpStatus.BAD_REQUEST,
                    "Reports can only be submitted within 24 hours after delivery",
                );
            }

            await tx.report.create({
                data: {
                    buyerId: user.id,
                    orderItemId: orderItem.id,
                    reason: payload.reason,
                    fileUrl: payload.fileUrl,
                },
            });

            return {
                orderId: orderItem.orderId,
                producerEarningId: orderItem.producerEarning?.id,
            };
        });

        if (report.producerEarningId) {
            await this.paymentQueue.cancelProducerTransfer(
                report.producerEarningId,
            );
        }

        const driverEarning = await this.prisma.driverEarning.findUnique({
            where: { orderId: report.orderId },
            select: { id: true },
        });
        if (driverEarning) {
            await this.paymentQueue.cancelDriverTransfer(driverEarning.id);
        }

        return { message: "Report submitted successfully" };
    }

    async submitReview(user: UserPayload, payload: CreateReviewDto) {
        await this.prisma.$transaction(async (tx) => {
            const orderItem = await tx.orderItem.findUnique({
                where: {
                    id: payload.orderItemId,
                    isReviewed: false,
                    order: { customerId: user.id, status: "Delivered" },
                },
                select: {
                    id: true,
                    productId: true,
                },
            });

            if (!orderItem) {
                throw new ApiError(
                    HttpStatus.BAD_REQUEST,
                    "Invalid order item or already reviewed",
                );
            }

            await tx.review.create({
                data: {
                    rating: payload.rating,
                    comment: payload.comment,
                    orderItemId: payload.orderItemId,
                    productId: orderItem.productId,
                    buyerId: user.id,
                },
            });

            await tx.orderItem.update({
                where: { id: payload.orderItemId },
                data: { isReviewed: true },
            });

            const reviewAverage = await tx.review.aggregate({
                where: { productId: orderItem.productId },
                _avg: { rating: true },
            });

            await tx.product.update({
                where: { id: orderItem.productId },
                data: {
                    totalReviews: { increment: 1 },
                    avgRating: Number(
                        (reviewAverage._avg.rating ?? 0).toFixed(1),
                    ),
                },
            });
        });

        return {
            message: "Review submitted successfully",
        };
    }
}

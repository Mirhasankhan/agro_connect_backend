import { Processor, WorkerHost } from "@nestjs/bullmq";
import { PrismaService } from "@/core/services/prisma/prisma.service";
import { StripeService } from "@/core/services/stripe/stripe.service";
import { Job } from "bullmq";
import {
    EARNINGS_QUEUE,
    TransferJobData,
} from "./payment-queue.service";
import { ApiError } from "@/common/errors/api_error";
import { HttpStatus } from "@nestjs/common";

@Processor(EARNINGS_QUEUE)
export class PaymentQueueProcessor extends WorkerHost {
    constructor(
        private readonly prisma: PrismaService,
        private readonly stripe: StripeService,
    ) {
        super();
    }

    async process(job: Job<TransferJobData>) {
        if (job.data.type === "producer") {
            await this.transferProducer(job.data.earningId);
        } else {
            await this.transferDriver(job.data.earningId);
        }
    }

    private async transferProducer(earningId: string) {
        console.log("came producer here");
        const earning = await this.prisma.producerEarning.findUnique({
            where: { id: earningId },
            include: {
                producer: { include: { producerProfile: true } },
                orderItem: { select: { report: { select: { id: true } } } },
            },
        });

        if (!earning || earning.isTransferred || earning.orderItem.report) return;

        // const accountId = earning.producer.producerProfile?.stripeAccountId;
        // if (!accountId) {
        //     throw new ApiError(HttpStatus.BAD_REQUEST, `Producer ${earning.producerId} has no Stripe account`);
        // }

        // const transfer = await this.stripe.createTransfer({
        //     amount: earning.amount,
        //     destination: accountId,
        //     idempotencyKey: `producer-earning-${earning.id}`,
        // });
        
        await this.prisma.producerEarning.updateMany({
            where: { id: earning.id, isTransferred: false },
            data: {
                isTransferred: true,
                stripeTransferId: "transfer.id",
                paidAt: new Date(),
            },
        });
    }

    private async transferDriver(earningId: string) {
        console.log("came driver here")
        const earning = await this.prisma.driverEarning.findUnique({
            where: { id: earningId },
            include: {
                driver: { include: { driverProfile: true } },
                order: {
                    select: {
                        items: { select: { report: { select: { id: true } } } },
                    },
                },
            },
        });

        if (
            !earning ||
            earning.isTransferred ||
            earning.order.items.some((item) => item.report)
        ) {
            return;
        }

        // const accountId = earning.driver.driverProfile?.stripeAccountId;
        // if (!accountId) {
        //     throw new ApiError(HttpStatus.BAD_REQUEST, `Driver ${earning.driverId} has no Stripe account`);
        // }

        // const transfer = await this.stripe.createTransfer({
        //     amount: earning.amount,
        //     destination: accountId,
        //     idempotencyKey: `driver-earning-${earning.id}`,
        // });

        await this.prisma.driverEarning.updateMany({
            where: { id: earning.id, isTransferred: false },
            data: {
                isTransferred: true,
                stripeTransferId: "transfer.id",
                paidAt: new Date(),
            },
        });
    }
}

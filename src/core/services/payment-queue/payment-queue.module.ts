import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import config from "@/config";
import { StripeService } from "@/core/services/stripe/stripe.service";
import {
    EARNINGS_QUEUE,
    PaymentQueueService,
} from "./payment-queue.service";
import { PaymentQueueProcessor } from "./payment-queue.processor";

@Module({
    imports: [
        BullModule.registerQueue({
            name: EARNINGS_QUEUE,
            connection: {
                url: config.redis.url,
                maxRetriesPerRequest: null,
            },
        }),
    ],
    providers: [PaymentQueueService, PaymentQueueProcessor, StripeService],
    exports: [PaymentQueueService],
})
export class PaymentQueueModule {}

import { HttpModule } from "@nestjs/axios";
import { JwtModule } from "@nestjs/jwt";
import { Module } from "@nestjs/common";
import { OrderService } from "./order.service";
import { OrderController } from "./order.controller";
import { StripeService } from "@/core/services/stripe/stripe.service";
import { StripeWebhookController } from "./stripe-webhook.controller";
import { NotificationModule } from "../notification/notification.module";
import { SocketModule } from "../socket/socket.module";
import { PaymentQueueModule } from "@/core/services/payment-queue/payment-queue.module";

@Module({
    imports: [
        PaymentQueueModule,
        HttpModule.register({
            timeout: 5000,
            maxRedirects: 5,
        }),
        JwtModule.register({ global: true }),
        NotificationModule,
        SocketModule,
    ],
    providers: [OrderService, StripeService],
    controllers: [OrderController, StripeWebhookController],
    exports: [OrderService, PaymentQueueModule],
})
export class OrderModule {}

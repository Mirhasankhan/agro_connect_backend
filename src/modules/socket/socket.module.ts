import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { SocketController } from "./socket.controller";
import { WebsocketGateway } from "./socket.io.service";
import { SocketPresenceService } from "./socket.presence.service";
import { SocketTrackingService } from "./socket.tracking.service";

@Module({
    imports: [JwtModule.register({ global: true })],
    controllers: [SocketController],
    providers: [WebsocketGateway, SocketPresenceService, SocketTrackingService],
    exports: [WebsocketGateway, SocketPresenceService, SocketTrackingService],
})
export class SocketModule {}


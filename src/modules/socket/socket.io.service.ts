import { PrismaService } from "@/core/services/prisma/prisma.service";
import { HttpStatus, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from "@nestjs/websockets";
import { UserRole } from "@prisma/client";
import { Server, Socket } from "socket.io";
import config from "@/config";
import { SocketPresenceService } from "./socket.presence.service";
import { SocketTrackingService } from "./socket.tracking.service";
import { ApiError } from "@/common/errors/api_error";

type SubscribePayload = {
    userId: string;
    token?: string;
};

type MessagePayload = {
    receiverId: string;
    message: string;
    images?: string[];
    token?: string;
};

type TrackingSubscribePayload = {
    deliveryId: string;
    token?: string;
};

type TrackingStartPayload = {
    deliveryId: string;
    latitude?: number;
    longitude?: number;
    heading?: number;
    speed?: number;
    token?: string;
};

type TrackingLocationPayload = {
    deliveryId: string;
    latitude: number;
    longitude: number;
    heading?: number;
    speed?: number;
    timestamp?: string | number;
    token?: string;
};

type TrackingStopPayload = {
    deliveryId: string;
    token?: string;
};

@WebSocketGateway({
    cors: { origin: "*", methods: ["GET", "POST"] },
    perMessageDeflate: false,
})
export class WebsocketGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(WebsocketGateway.name);
    constructor(
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService,
        private readonly jwtService: JwtService,
        private readonly presence: SocketPresenceService,
        private readonly trackingService: SocketTrackingService,
    ) { }

    afterInit(server: Server) {
        server.use(async (socket: Socket, next: (err?: Error) => void) => {
            try {
                const token = this.extractToken(socket);
                if (token) {
                    const userId = await this.validateToken(token);
                    if (userId) {
                        socket.data.userId = userId;
                    }
                }
                next();
            } catch (err) {
                this.logger.warn(
                    `Socket connection handshake auth warning: ${(err as Error).message}`,
                );
                next();
            }
        });
    }

    async handleConnection(socket: Socket) {
        try {
            let userId = socket.data.userId as string | undefined;
            if (!userId) {
                const token = this.extractToken(socket);
                if (token) {
                    userId = await this.validateToken(token);
                    if (userId) {
                        socket.data.userId = userId;
                    }
                }
            }

            if (!userId) {
                this.logger.warn(
                    `Socket ${socket.id} connected without initial valid auth`,
                );
                this.emitError(socket, "Authentication failed");
                socket.disconnect(true);
                return;
            }

            this.presence.add(userId, socket.id);
            socket.emit("authenticated", { userId, message: "Authenticated" });
        } catch (err) {
            this.logger.warn(
                `Socket ${socket.id} auth failed: ${(err as Error).message}`,
            );
            this.emitError(socket, "Authentication failed");
            socket.disconnect(true);
        }
    }

    handleDisconnect(socket: Socket) {
        const userId = socket.data.userId as string | undefined;
        if (!userId) return;

        this.presence.remove(userId, socket.id);
    }

    @SubscribeMessage("subscribe")
    async subscribe(
        @MessageBody() rawPayload: unknown,
        @ConnectedSocket() socket: Socket,
    ) {
        try {
            let userId = socket.data.userId as string | undefined;
            const payload = this.parsePayload<SubscribePayload>(rawPayload);

            // Defensive authentication check in case handshake was delayed
            if (!userId) {
                const token = this.extractToken(socket, payload);
                if (token) {
                    userId = await this.validateToken(token);
                    if (userId) {
                        socket.data.userId = userId;
                        this.presence.add(userId, socket.id);
                        socket.emit("authenticated", {
                            userId,
                            message: "Authenticated",
                        });
                    }
                }
            }

            if (!userId) {
                return this.emitError(socket, "Not authenticated");
            }

            if (!payload.userId || userId === payload.userId) {
                return this.emitError(
                    socket,
                    "A valid conversation user is required",
                );
            }

            const conversation = await this.getOrCreateConversation(
                userId,
                payload.userId,
            );
            const room = this.roomName(conversation.id);
            await socket.join(room);

            await this.prisma.chatMessage.updateMany({
                where: {
                    conversationId: conversation.id,
                    receiverId: userId,
                    isRead: false,
                },
                data: { isRead: true },
            });

            const messages = await this.prisma.chatMessage.findMany({
                where: { conversationId: conversation.id },
                orderBy: { createdAt: "asc" },
                select: {
                    id: true,
                    message: true,
                    images: true,
                    isRead: true,
                    createdAt: true,
                    senderId: true,
                },
            });

            const participant = await this.prisma.user.findUnique({
                where: { id: payload.userId },
                select: {
                    id: true,
                    fullName: true,
                    role: true,
                    profileImage: true,
                },
            });

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { participantA, participantB, ...conversationDetails } =
                conversation;

            socket.emit("conversationHistory", {
                conversation: {
                    ...conversationDetails,
                    participant: participant
                        ? {
                            ...participant,
                            isOnline: this.presence.isOnline(participant.id),
                        }
                        : null,
                },
                messages: messages.map(({ senderId, ...message }) => ({
                    ...message,
                    isSendByMe: senderId === userId,
                })),
            });
        } catch (err) {
            this.handleError(socket, err, "subscribe");
        }
    }

    @SubscribeMessage("sendMessage")
    async sendMessage(
        @MessageBody() rawPayload: unknown,
        @ConnectedSocket() socket: Socket,
    ) {
        try {
            let senderId = socket.data.userId as string | undefined;
            const payload = this.parsePayload<MessagePayload>(rawPayload);

            // Defensive authentication check
            if (!senderId) {
                const token = this.extractToken(socket, payload);
                if (token) {
                    senderId = await this.validateToken(token);
                    if (senderId) {
                        socket.data.userId = senderId;
                        this.presence.add(senderId, socket.id);
                        socket.emit("authenticated", {
                            userId: senderId,
                            message: "Authenticated",
                        });
                    }
                }
            }

            if (!senderId) {
                return this.emitError(socket, "Not authenticated");
            }

            if (!payload.receiverId || !payload.message?.trim()) {
                return this.emitError(
                    socket,
                    "Receiver and message are required",
                );
            }

            const conversation = await this.getOrCreateConversation(
                senderId,
                payload.receiverId,
            );
            const room = this.roomName(conversation.id);
            if (!socket.rooms.has(room)) {
                await socket.join(room);
            }

            const savedMessage = await this.prisma.chatMessage.create({
                data: {
                    conversationId: conversation.id,
                    senderId,
                    receiverId: payload.receiverId,
                    message: payload.message.trim(),
                    images: Array.isArray(payload.images) ? payload.images : [],
                },
            });

            await this.prisma.conversation.update({
                where: { id: conversation.id },
                data: { updatedAt: new Date() },
            });

            const sockets = await this.server.in(room).fetchSockets();
            const isRecipientSubscribed = sockets.some(
                (targetSocket) =>
                    targetSocket.data.userId === payload.receiverId,
            );

            if (isRecipientSubscribed) {
                await this.prisma.chatMessage.update({
                    where: { id: savedMessage.id },
                    data: { isRead: true },
                });
            }

            for (const targetSocket of sockets) {
                const { senderId: msgSenderId, ...message } = savedMessage;
                targetSocket.emit("message", {
                    ...message,
                    isRead: isRecipientSubscribed,
                    isSendByMe: msgSenderId === targetSocket.data.userId,
                });
            }
        } catch (err) {
            this.handleError(socket, err, "sendMessage");
        }
    }

    private async validateToken(token: string): Promise<string | null> {
        try {
            const secret =
                this.configService.get<string>("JWT_SECRET") ||
                config.jwt.jwt_secret;

            const payload = await this.jwtService.verifyAsync(token, {
                secret,
            });

            const userId = (payload.id ?? payload.userId ?? payload.sub) as
                string | undefined;
            if (!userId) return null;

            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, deleted: true },
            });

            if (!user || user.deleted) return null;

            return userId;
        } catch {
            return null;
        }
    }

    private extractToken(socket: Socket, payload?: Record<string, unknown>): string | null {
        const { auth, query, headers } = socket.handshake;

        const raw =
            payload?.token ??
            auth?.token ??
            auth?.accessToken ??
            query?.token ??
            query?.accessToken ??
            headers?.token ??
            headers?.authorization;

        const value = Array.isArray(raw) ? raw[0] : raw;
        if (!value) return null;

        const token = String(value)
            .trim()
            .replace(/^Bearer\s+/i, "");
        return token || null;
    }

    private parsePayload<T>(payload: unknown): Partial<T> {
        if (typeof payload === "string") {
            try {
                const parsed = JSON.parse(payload);
                return parsed && typeof parsed === "object"
                    ? (parsed as Partial<T>)
                    : {};
            } catch {
                return {};
            }
        }
        return payload && typeof payload === "object"
            ? (payload as Partial<T>)
            : {};
    }

    private async getOrCreateConversation(userId: string, otherUserId: string) {
        const [participantA, participantB] = [userId, otherUserId].sort();

        const [otherUser, currentUser] = await Promise.all([
            this.prisma.user.findUnique({
                where: { id: otherUserId },
                select: { id: true, role: true, deleted: true },
            }),
            this.prisma.user.findUnique({
                where: { id: userId },
                select: { role: true },
            }),
        ]);

        if (
            !otherUser ||
            otherUser.deleted ||
            !this.isAllowedConversation(otherUser.role)
        ) {
            throw new ApiError(HttpStatus.NOT_FOUND, "User is not available for messaging");
        }

        if (
            !currentUser ||
            !this.isAllowedConversationPair(currentUser.role, otherUser.role)
        ) {
            throw new ApiError(HttpStatus.FORBIDDEN,
                "Only buyer-producer and buyer-driver conversations are allowed",
            );
        }

        return this.prisma.conversation.upsert({
            where: {
                participantA_participantB: { participantA, participantB },
            },
            create: { participantA, participantB },
            update: {},
        });
    }

    private isAllowedConversation(role: UserRole) {
        return (
            role === UserRole.BUYER ||
            role === UserRole.PRODUCER ||
            role === UserRole.DRIVER ||
            role === UserRole.ADMIN
        );
    }

    private isAllowedConversationPair(first: UserRole, second: UserRole) {
        if (first === UserRole.ADMIN || second === UserRole.ADMIN) {
            return true;
        }
        return (
            (first === UserRole.BUYER &&
                (second === UserRole.PRODUCER || second === UserRole.DRIVER)) ||
            (second === UserRole.BUYER &&
                (first === UserRole.PRODUCER || first === UserRole.DRIVER)) ||
            (first === UserRole.PRODUCER && second === UserRole.DRIVER) ||
            (first === UserRole.DRIVER && second === UserRole.PRODUCER)
        );
    }

    private roomName(conversationId: string) {
        return `conversation:${conversationId}`;
    }

    deliveryRoomName(deliveryId: string) {
        return `delivery:${deliveryId}`;
    }

    // ==========================================
    // Real-Time Driver Tracking Event Handlers
    // ==========================================

    @SubscribeMessage("tracking:subscribe")
    @SubscribeMessage("subscribeTracking")
    async handleTrackingSubscribe(
        @MessageBody() rawPayload: unknown,
        @ConnectedSocket() socket: Socket,
    ) {
        try {
            const payload = this.parsePayload<TrackingSubscribePayload>(rawPayload);
            const userId = await this.ensureAuthenticatedUserId(socket, payload);
            if (!userId) {
                return this.emitTrackingError(socket, "Not authenticated", payload.deliveryId);
            }

            if (!payload.deliveryId) {
                return this.emitTrackingError(socket, "Delivery ID is required for tracking subscription");
            }

            const auth = await this.trackingService.validateViewerAuthorization(
                payload.deliveryId,
                userId,
            );

            const room = this.deliveryRoomName(payload.deliveryId);
            await socket.join(room);

            // Send initial snapshot directly to subscriber
            socket.emit("tracking:initial", {
                deliveryId: payload.deliveryId,
                orderId: auth.delivery.order.orderId,
                orderDbId: auth.delivery.order.id,
                orderStatus: auth.delivery.order.status,
                status: auth.delivery.status,
                isTracking: auth.delivery.isTracking,
                startLatitude: auth.delivery.startLatitude,
                startLongitude: auth.delivery.startLongitude,
                latitude: auth.delivery.latitude,
                longitude: auth.delivery.longitude,
                heading: auth.delivery.heading,
                speed: auth.delivery.speed,
                trackingStartedAt: auth.delivery.trackingStartedAt,
                trackingUpdatedAt: auth.delivery.trackingUpdatedAt,
                driver: auth.delivery.driver,
                customer: auth.delivery.order.customer,
                shippingAddress: auth.delivery.order.shippingAddress,
            });

            this.logger.debug(
                `Socket ${socket.id} (user ${userId}, role ${auth.role}) subscribed to tracking room ${room}`,
            );
        } catch (err) {
            this.handleError(socket, err, "tracking:subscribe");
        }
    }

    @SubscribeMessage("tracking:unsubscribe")
    @SubscribeMessage("unsubscribeTracking")
    async handleTrackingUnsubscribe(
        @MessageBody() rawPayload: unknown,
        @ConnectedSocket() socket: Socket,
    ) {
        try {
            const payload = this.parsePayload<TrackingSubscribePayload>(rawPayload);
            if (payload.deliveryId) {
                const room = this.deliveryRoomName(payload.deliveryId);
                await socket.leave(room);
                socket.emit("tracking:unsubscribed", { deliveryId: payload.deliveryId });
                this.logger.debug(`Socket ${socket.id} left tracking room ${room}`);
            }
        } catch (err) {
            this.handleError(socket, err, "tracking:unsubscribe");
        }
    }

    @SubscribeMessage("tracking:start")
    @SubscribeMessage("startDriverTracking")
    async handleTrackingStart(
        @MessageBody() rawPayload: unknown,
        @ConnectedSocket() socket: Socket,
    ) {
        try {
            const payload = this.parsePayload<TrackingStartPayload>(rawPayload);
            const userId = await this.ensureAuthenticatedUserId(socket, payload);
            if (!userId) {
                return this.emitTrackingError(socket, "Not authenticated", payload.deliveryId);
            }

            if (!payload.deliveryId) {
                return this.emitTrackingError(socket, "Delivery ID is required to start tracking");
            }

            const updated = await this.trackingService.startTracking(
                payload.deliveryId,
                userId,
                {
                    latitude: payload.latitude,
                    longitude: payload.longitude,
                    heading: payload.heading,
                    speed: payload.speed,
                },
            );

            const room = this.deliveryRoomName(payload.deliveryId);
            await socket.join(room);

            // Broadcast tracking started status to all room subscribers
            this.server.to(room).emit("tracking:status", {
                deliveryId: payload.deliveryId,
                isTracking: true,
                status: updated.status,
                startLatitude: updated.startLatitude,
                startLongitude: updated.startLongitude,
                latitude: updated.latitude,
                longitude: updated.longitude,
                heading: updated.heading,
                speed: updated.speed,
                trackingStartedAt: updated.trackingStartedAt,
                trackingUpdatedAt: updated.trackingUpdatedAt,
                timestamp: new Date().toISOString(),
            });

            socket.emit("tracking:started", {
                deliveryId: payload.deliveryId,
                isTracking: true,
            });
        } catch (err) {
            this.handleError(socket, err, "tracking:start");
        }
    }

    @SubscribeMessage("tracking:update")
    @SubscribeMessage("tracking:location")
    @SubscribeMessage("driverLocationUpdate")
    async handleTrackingLocationUpdate(
        @MessageBody() rawPayload: unknown,
        @ConnectedSocket() socket: Socket,
    ) {
        try {
            const payload = this.parsePayload<TrackingLocationPayload>(rawPayload);
            const userId = await this.ensureAuthenticatedUserId(socket, payload);
            if (!userId) {
                return this.emitTrackingError(socket, "Not authenticated", payload.deliveryId);
            }

            if (!payload.deliveryId || typeof payload.latitude !== "number" || typeof payload.longitude !== "number") {
                return this.emitTrackingError(socket, "Valid deliveryId, latitude, and longitude are required");
            }

            const broadcastData = await this.trackingService.processLocationUpdate(userId, {
                deliveryId: payload.deliveryId,
                latitude: payload.latitude,
                longitude: payload.longitude,
                heading: payload.heading,
                speed: payload.speed,
                timestamp: payload.timestamp,
            });

            const room = this.deliveryRoomName(payload.deliveryId);
            if (!socket.rooms.has(room)) {
                await socket.join(room);
            }

            // Broadcast real-time location event to all subscribers in delivery room
            this.server.to(room).emit("tracking:location", broadcastData);
        } catch (err) {
            this.handleError(socket, err, "tracking:update");
        }
    }

    @SubscribeMessage("tracking:stop")
    @SubscribeMessage("stopDriverTracking")
    async handleTrackingStop(
        @MessageBody() rawPayload: unknown,
        @ConnectedSocket() socket: Socket,
    ) {
        try {
            const payload = this.parsePayload<TrackingStopPayload>(rawPayload);
            const userId = await this.ensureAuthenticatedUserId(socket, payload);
            if (!userId) {
                return this.emitTrackingError(socket, "Not authenticated", payload.deliveryId);
            }

            if (!payload.deliveryId) {
                return this.emitTrackingError(socket, "Delivery ID is required to stop tracking");
            }

            const updated = await this.trackingService.stopTracking(payload.deliveryId, userId);

            const room = this.deliveryRoomName(payload.deliveryId);
            this.server.to(room).emit("tracking:status", {
                deliveryId: payload.deliveryId,
                isTracking: false,
                status: updated.status,
                trackingUpdatedAt: updated.trackingUpdatedAt,
                timestamp: new Date().toISOString(),
            });

            socket.emit("tracking:stopped", {
                deliveryId: payload.deliveryId,
                isTracking: false,
            });
        } catch (err) {
            this.handleError(socket, err, "tracking:stop");
        }
    }

    notifyDeliveryStatusChanged(deliveryId: string, status: string, isTracking = false) {
        const room = this.deliveryRoomName(deliveryId);
        this.server?.to(room).emit("tracking:status", {
            deliveryId,
            isTracking,
            status,
            timestamp: new Date().toISOString(),
        });
    }

    private emitTrackingError(socket: Socket, message: string, deliveryId?: string) {
        socket.emit("tracking:error", { message, deliveryId });
    }

    private async ensureAuthenticatedUserId(
        socket: Socket,
        payload?: Record<string, unknown>,
    ): Promise<string | null> {
        let userId = socket.data.userId as string | undefined;
        if (!userId) {
            const token = this.extractToken(socket, payload);
            if (token) {
                userId = await this.validateToken(token);
                if (userId) {
                    socket.data.userId = userId;
                    this.presence.add(userId, socket.id);
                    socket.emit("authenticated", {
                        userId,
                        message: "Authenticated",
                    });
                }
            }
        }
        return userId || null;
    }

    private handleError(socket: Socket, err: unknown, event: string) {
        const message =
            err instanceof Error ? err.message : "Something went wrong";
        this.logger.error(
            `${event} failed for socket ${socket.id}: ${message}`,
        );
        this.emitError(socket, message);
    }

    private emitError(socket: Socket, message: string) {
        socket.emit("error", { message });
    }
}

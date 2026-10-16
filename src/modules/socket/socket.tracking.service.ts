import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/core/services/prisma/prisma.service";
import { ApiError } from "@/common/errors/api_error";
import { Prisma, UserRole } from "@prisma/client";

export interface LocationPayload {
    deliveryId: string;
    latitude: number;
    longitude: number;
    heading?: number | null;
    speed?: number | null;
    timestamp?: string | number;
}

@Injectable()
export class SocketTrackingService {
    private readonly logger = new Logger(SocketTrackingService.name);
    private readonly lastSavedTimes = new Map<string, number>();
    private readonly DB_PERSIST_THROTTLE_MS = 3500; // Persist to MongoDB at most once every 3.5s

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Verifies that the requester is authorized to view this delivery's live tracking.
     * Allowed: Assigned Driver, Customer (Buyer) of the order, or Admin.
     */
    async validateViewerAuthorization(deliveryId: string, userId: string) {
        if (!deliveryId || !userId) {
            throw new ApiError(HttpStatus.UNAUTHORIZED, "Authentication and delivery ID are required");
        }

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, deleted: true, status: true },
        });

        if (!user || user.deleted || user.status !== "ACTIVE") {
            throw new ApiError(HttpStatus.FORBIDDEN, "User account is inactive or not found");
        }

        const delivery = await this.prisma.delivery.findUnique({
            where: { id: deliveryId },
            include: {
                order: {
                    select: {
                        id: true,
                        orderId: true,
                        customerId: true,
                        status: true,
                        shippingAddress: {
                            select: {
                                id: true,
                                addressLine: true,
                                city: true,
                                postCode: true,
                                instruction: true,
                            },
                        },
                        customer: {
                            select: {
                                id: true,
                                fullName: true,
                                phoneNumber: true,
                                profileImage: true,
                            },
                        },
                    },
                },
                driver: {
                    select: {
                        id: true,
                        fullName: true,
                        phoneNumber: true,
                        profileImage: true,
                        driverProfile: {
                            select: {
                                vehicleType: true,
                                registrationNumber: true,
                            },
                        },
                    },
                },
            },
        });

        if (!delivery) {
            throw new ApiError(HttpStatus.NOT_FOUND, "Delivery record not found");
        }

        // Admin has full access
        if (user.role === UserRole.ADMIN) {
            return { authorized: true, role: UserRole.ADMIN, delivery };
        }

        // Assigned driver has access
        if (delivery.driverId === userId) {
            return { authorized: true, role: UserRole.DRIVER, delivery };
        }

        // Customer buyer who owns the order has access
        if (delivery.order.customerId === userId) {
            return { authorized: true, role: UserRole.BUYER, delivery };
        }

        throw new ApiError(
            HttpStatus.FORBIDDEN,
            "You are not authorized to view tracking for this delivery",
        );
    }

    /**
     * Verifies that the requester is the assigned driver for this delivery and the delivery is still active.
     */
    async validateDriverAuthorization(deliveryId: string, driverUserId: string) {
        if (!deliveryId || !driverUserId) {
            throw new ApiError(HttpStatus.UNAUTHORIZED, "Driver authentication and delivery ID are required");
        }

        const delivery = await this.prisma.delivery.findUnique({
            where: { id: deliveryId },
            select: {
                id: true,
                driverId: true,
                status: true,
                isTracking: true,
                startLatitude: true,
                startLongitude: true,
                latitude: true,
                longitude: true,
                order: {
                    select: {
                        id: true,
                        orderId: true,
                        status: true,
                        customerId: true,
                    },
                },
            },
        });

        if (!delivery) {
            throw new ApiError(HttpStatus.NOT_FOUND, "Delivery not found");
        }

        if (delivery.driverId !== driverUserId) {
            throw new ApiError(HttpStatus.FORBIDDEN, "Only the assigned driver can transmit location for this delivery");
        }

        if (delivery.status === "Delivered") {
            throw new ApiError(HttpStatus.BAD_REQUEST, "Delivery has already been marked as Delivered");
        }

        if (delivery.order.status === "Cancelled" || delivery.order.status === "Refunded") {
            throw new ApiError(HttpStatus.BAD_REQUEST, "Order has been cancelled");
        }

        return delivery;
    }

    /**
     * Starts live tracking session for a delivery.
     */
    async startTracking(
        deliveryId: string,
        driverUserId: string,
        initialCoords?: { latitude?: number; longitude?: number; heading?: number; speed?: number },
    ) {
        await this.validateDriverAuthorization(deliveryId, driverUserId);

        const now = new Date();
        const updateData: Prisma.DeliveryUpdateInput = {
            isTracking: true,
            trackingStartedAt: now,
            trackingUpdatedAt: now,
        };

        if (
            typeof initialCoords?.latitude === "number" &&
            typeof initialCoords?.longitude === "number" &&
            !isNaN(initialCoords.latitude) &&
            !isNaN(initialCoords.longitude)
        ) {
            updateData.startLatitude = initialCoords.latitude;
            updateData.startLongitude = initialCoords.longitude;
            updateData.latitude = initialCoords.latitude;
            updateData.longitude = initialCoords.longitude;
            if (typeof initialCoords.heading === "number") updateData.heading = initialCoords.heading;
            if (typeof initialCoords.speed === "number") updateData.speed = initialCoords.speed;
        }

        const updated = await this.prisma.delivery.update({
            where: { id: deliveryId },
            data: updateData,
            select: {
                id: true,
                orderId: true,
                status: true,
                isTracking: true,
                startLatitude: true,
                startLongitude: true,
                latitude: true,
                longitude: true,
                heading: true,
                speed: true,
                trackingStartedAt: true,
                trackingUpdatedAt: true,
            },
        });

        this.lastSavedTimes.set(deliveryId, Date.now());
        this.logger.log(`Driver ${driverUserId} started live tracking for delivery ${deliveryId}`);

        return updated;
    }

    /**
     * Validates and processes a location fix from the driver.
     * Immediately returns sanitized payload for real-time broadcast and throttles DB writes.
     */
    async processLocationUpdate(driverUserId: string, payload: LocationPayload) {
        const { deliveryId, latitude, longitude, heading, speed, timestamp } = payload;

        if (
            typeof latitude !== "number" ||
            isNaN(latitude) ||
            latitude < -90 ||
            latitude > 90 ||
            typeof longitude !== "number" ||
            isNaN(longitude) ||
            longitude < -180 ||
            longitude > 180
        ) {
            throw new ApiError(HttpStatus.BAD_REQUEST, "Invalid GPS coordinates");
        }

        const delivery = await this.validateDriverAuthorization(deliveryId, driverUserId);

        const now = Date.now();
        const lastSaved = this.lastSavedTimes.get(deliveryId) || 0;

        const effectiveStartLat = delivery.startLatitude ?? latitude;
        const effectiveStartLng = delivery.startLongitude ?? longitude;

        // Throttled persistence to MongoDB: only write if threshold passed
        if (now - lastSaved >= this.DB_PERSIST_THROTTLE_MS) {
            this.lastSavedTimes.set(deliveryId, now);
            const dbData: Prisma.DeliveryUpdateInput = {
                latitude,
                longitude,
                heading: typeof heading === "number" ? heading : null,
                speed: typeof speed === "number" ? speed : null,
                isTracking: true,
                trackingUpdatedAt: new Date(),
            };
            if (delivery.startLatitude === null || delivery.startLatitude === undefined) {
                dbData.startLatitude = latitude;
                dbData.startLongitude = longitude;
            }

            this.prisma.delivery
                .update({
                    where: { id: deliveryId },
                    data: dbData,
                })
                .catch((err) => {
                    this.logger.error(`Failed to persist location to DB for delivery ${deliveryId}: ${err.message}`);
                });
        }

        return {
            deliveryId,
            startLatitude: effectiveStartLat,
            startLongitude: effectiveStartLng,
            latitude,
            longitude,
            heading: typeof heading === "number" ? heading : null,
            speed: typeof speed === "number" ? speed : null,
            status: delivery.status,
            isTracking: true,
            timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
        };
    }

    /**
     * Stops tracking session for a delivery.
     */
    async stopTracking(deliveryId: string, userId: string) {
        const auth = await this.validateViewerAuthorization(deliveryId, userId);

        if (auth.role !== UserRole.DRIVER && auth.role !== UserRole.ADMIN) {
            throw new ApiError(HttpStatus.FORBIDDEN, "Only the assigned driver or admin can stop tracking");
        }

        const now = new Date();
        const updated = await this.prisma.delivery.update({
            where: { id: deliveryId },
            data: {
                isTracking: false,
                trackingUpdatedAt: now,
            },
            select: {
                id: true,
                orderId: true,
                status: true,
                isTracking: true,
                latitude: true,
                longitude: true,
                heading: true,
                speed: true,
                trackingUpdatedAt: true,
            },
        });

        this.lastSavedTimes.delete(deliveryId);
        this.logger.log(`Live tracking stopped for delivery ${deliveryId} by ${userId}`);

        return updated;
    }

    /**
     * Retrieves the latest tracking snapshot for an authorized user.
     */
    async getTrackingSnapshot(deliveryId: string, userId: string) {
        const { delivery } = await this.validateViewerAuthorization(deliveryId, userId);

        return {
            deliveryId: delivery.id,
            orderId: delivery.order.orderId,
            orderDbId: delivery.order.id,
            orderStatus: delivery.order.status,
            status: delivery.status,
            isTracking: delivery.isTracking,
            startLatitude: delivery.startLatitude,
            startLongitude: delivery.startLongitude,
            latitude: delivery.latitude,
            longitude: delivery.longitude,
            heading: delivery.heading,
            speed: delivery.speed,
            trackingStartedAt: delivery.trackingStartedAt,
            trackingUpdatedAt: delivery.trackingUpdatedAt,
            driver: delivery.driver,
            customer: delivery.order.customer,
            shippingAddress: delivery.order.shippingAddress,
        };
    }

    /**
     * Marks tracking stopped when delivery finishes.
     */
    async markDeliveryDelivered(deliveryId: string) {
        try {
            await this.prisma.delivery.update({
                where: { id: deliveryId },
                data: {
                    isTracking: false,
                    trackingUpdatedAt: new Date(),
                },
            });
            this.lastSavedTimes.delete(deliveryId);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Could not mark delivery ${deliveryId} tracking closed: ${message}`);
        }
    }
}

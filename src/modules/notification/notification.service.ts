import { PrismaService } from "@/core/services/prisma/prisma.service";
import { TNotificationType } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import { UserPayload } from "@/common/guards/auth.guard";
import QueryBuilder from "@/common/utils/queryBuilder";
import { NotificationQueryDto } from "./dto/body.dto";

export interface CreateNotificationInput {
    receiverId: string;
    title: string;
    content: string;
    notificationType: TNotificationType;
}

@Injectable()
export class NotificationService {
    constructor(private prisma: PrismaService) {}

    async createNotification(input: CreateNotificationInput) {
        return this.prisma.notification.create({
            data: input,
        });
    }

    async getNotificationsByReceiverId(user: UserPayload, query: NotificationQueryDto) {
        const queryBuilder = new QueryBuilder(this.prisma.notification, query);

        const response = await queryBuilder
            .filter({
                exacts: ["notificationType"],
            })
            .rawFilter({
                receiverId: user.id,
            })
            .sortBy({ createdAt: "desc" })
            .paginate()            
            .execute();

        const fetchedIds = ((response as any[]) || []).map((n) => n.id);
        if (fetchedIds.length > 0) {
            await this.prisma.notification.updateMany({
                where: {
                    id: { in: fetchedIds },
                    isRead: false,
                },
                data: {
                    isRead: true,
                },
            });
        }

        const [notifications, pagination] = await Promise.all([
            response,
            queryBuilder.countTotal(),
        ]);

        return {
            message: "Notifications fetched successfully",
            data: {
                notifications,
                meta: pagination,
            },
        };
    }

    async getUnreadCount(user: UserPayload) {
        const count = await this.prisma.notification.count({
            where: {
                receiverId: user.id,
                isRead: false,
            },
        });

        return {
            message: "Unread notifications count fetched successfully",
            data: {
                unreadCount: count,
            },
        };
    }
}



import { IsEnum, IsOptional } from "class-validator";
import { TNotificationType } from "@prisma/client";

export class NotificationQueryDto {
    @IsOptional()
    @IsEnum(TNotificationType)
    notificationType?: TNotificationType;
}
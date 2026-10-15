import { IsEnum, IsOptional, IsString } from "class-validator";
import { TNotificationType } from "@prisma/client";

export class NotificationQueryDto {
    @IsOptional()
    @IsEnum(TNotificationType)
    notificationType?: TNotificationType;

    @IsOptional()
    @IsString()
    page?: string;

    @IsOptional()
    @IsString()
    limit?: string;
}
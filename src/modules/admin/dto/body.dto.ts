import {
    DriverVehicleType,
    OrderStatus,
    ProducerType,
    ReportStatus,
    VerificationStatus,
} from "@prisma/client";
import {
    IsBoolean,
    IsOptional,
    IsString,
    IsNumber,
    IsMongoId,
    IsEnum,
    IsIn,
} from "class-validator";

export class AcceptRejectAccountDto {
    @IsMongoId()
    accountId: string;

    @IsBoolean()
    isAccept: boolean;

    @IsOptional()
    @IsString()
    rejectReason?: string;
}

export class CategoryDto {
    @IsString()
    name: string;

    @IsString()
    slug: string;

    @IsString()
    description: string;
}

export class BaseUserQueryDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsEnum(["asc", "desc"])
    order?: "asc" | "desc";

    @IsOptional()
    @IsString()
    page?: string;

    @IsOptional()
    @IsEnum(VerificationStatus)
    verificationStatus?: VerificationStatus;

    @IsOptional()
    @IsString()
    limit?: string;
}

export class ProducerQueryDto extends BaseUserQueryDto {
    @IsOptional()
    @IsEnum(ProducerType)
    producerType?: ProducerType;
}

export class DriverQueryDto extends BaseUserQueryDto {
    @IsOptional()
    @IsEnum(DriverVehicleType)
    vehicleType?: DriverVehicleType;
}

export class AssignDriverDto {
    @IsMongoId()
    orderId: string;

    @IsMongoId()
    driverId: string;
}

export class EarningQueryDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsIn(["true", "false"])
    isTransferred?: string;

    @IsOptional()
    @IsEnum(["asc", "desc"])
    order?: "asc" | "desc";

    @IsOptional()
    @IsString()
    page?: string;

    @IsOptional()
    @IsString()
    limit?: string;
}

export class ReportQueryDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsEnum(ReportStatus)
    status?: ReportStatus;

    @IsOptional()
    @IsEnum(["asc", "desc"])
    order?: "asc" | "desc";

    @IsOptional()
    @IsString()
    page?: string;

    @IsOptional()
    @IsString()
    limit?: string;
}

export class ResolveReportDto {
    @IsEnum(ReportStatus)
    status: ReportStatus;

    @IsOptional()
    @IsString()
    adminComment?: string;
}

export class AdminCancelOrderDto {
    @IsString()
    reason: string;

    @IsOptional()
    @IsIn(["FULL", "ITEMS_ONLY", "CUSTOM", "NONE"])
    refundType?: "FULL" | "ITEMS_ONLY" | "CUSTOM" | "NONE";

    @IsOptional()
    @IsNumber()
    customRefundAmount?: number;

    @IsOptional()
    @IsBoolean()
    restoreInventory?: boolean;
}

export class AdminCancelOrderItemDto {
    @IsString()
    reason: string;

    @IsOptional()
    @IsNumber()
    refundAmount?: number;

    @IsOptional()
    @IsBoolean()
    restoreInventory?: boolean;
}


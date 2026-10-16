import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Max,
    Min,
} from "class-validator";
import { Type } from "class-transformer";

export class StartTrackingDto {
    @ApiProperty({ description: "ID of the delivery to track" })
    @IsNotEmpty()
    @IsString()
    deliveryId: string;

    @ApiPropertyOptional({ description: "Current driver latitude", example: 5.36 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(-90)
    @Max(90)
    latitude?: number;

    @ApiPropertyOptional({ description: "Current driver longitude", example: -4.008 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(-180)
    @Max(180)
    longitude?: number;

    @ApiPropertyOptional({ description: "Compass heading in degrees (0-360)", example: 45 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    heading?: number;

    @ApiPropertyOptional({ description: "Current travel speed in m/s", example: 12.5 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    speed?: number;
}

export class UpdateLocationDto {
    @ApiProperty({ description: "ID of the delivery being updated" })
    @IsNotEmpty()
    @IsString()
    deliveryId: string;

    @ApiProperty({ description: "Current driver latitude", example: 5.36 })
    @Type(() => Number)
    @IsNumber()
    @Min(-90)
    @Max(90)
    latitude: number;

    @ApiProperty({ description: "Current driver longitude", example: -4.008 })
    @Type(() => Number)
    @IsNumber()
    @Min(-180)
    @Max(180)
    longitude: number;

    @ApiPropertyOptional({ description: "Compass heading in degrees (0-360)", example: 45 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    heading?: number;

    @ApiPropertyOptional({ description: "Current travel speed in m/s", example: 12.5 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    speed?: number;

    @ApiPropertyOptional({ description: "ISO timestamp or epoch of location fix" })
    @IsOptional()
    timestamp?: string | number;
}

export class StopTrackingDto {
    @ApiProperty({ description: "ID of the delivery to stop tracking" })
    @IsNotEmpty()
    @IsString()
    deliveryId: string;
}

export class SubscribeTrackingDto {
    @ApiProperty({ description: "ID of the delivery to subscribe to" })
    @IsNotEmpty()
    @IsString()
    deliveryId: string;
}

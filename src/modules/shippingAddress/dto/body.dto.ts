import { IsOptional, IsString } from "class-validator";

export class ShippingAddressDto {
    @IsString()
    addressLine: string;

    @IsString()
    city: string;

    @IsString()
    postCode: string;   

    @IsOptional()
    @IsString()
    instruction?: string;
}


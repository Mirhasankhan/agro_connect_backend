import {
    Body,
    Controller,
    Get,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    UploadedFile,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { ResponseService } from "@/common/interceptors/response";
import { Roles } from "@/common/decorators/roles.decorator";
import { UserRole } from "@prisma/client";
import {
    AcceptRejectAccountDto,
    CategoryDto,
    DriverQueryDto,
    ProducerQueryDto,
    AssignDriverDto,
    BaseUserQueryDto,
    EarningQueryDto,
} from "./dto/body.dto";
import { CustomFileInterceptor } from "@/common/interceptors/file_interceptors";
import { ParseFormDataInterceptor } from "@/common/interceptors/form_data_interceptor";
import { IsPublic } from "@/common/decorators/auth.decorator";
import { OrderQueryDto } from "../order/dto/body.dto";

@ApiTags("Admin")
@Controller("admin")
export class AdminController {
    constructor(private adminService: AdminService) {}

    @Get("all-producers")
    @ApiOperation({ summary: "All producers" })
    @Roles(UserRole.ADMIN)
    async allProducers(@Query() query: ProducerQueryDto) {
        const result = await this.adminService.getAllProducerFromDB(query);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }

    @Get("producer-details/:id")
    @ApiOperation({ summary: "Producer details" })
    @Roles(UserRole.ADMIN)
    async producerDetails(@Param("id") id: string) {
        const result = await this.adminService.getProducerDetailsFromDB(id);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }

    @Patch("producer-approval")
    @ApiOperation({ summary: "Accept/reject producer account" })
    @Roles(UserRole.ADMIN)
    async acceptRejectProducerAccount(@Body() payload: AcceptRejectAccountDto) {
        const result =
            await this.adminService.acceptRejectProducerAccount(payload);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
        });
    }

    @Get("all-drivers")
    @ApiOperation({ summary: "All drivers" })
    @Roles(UserRole.ADMIN)
    async allDrivers(@Query() query: DriverQueryDto) {
        const result = await this.adminService.getAllDriverFromDB(query);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }

    @Get("driver-details/:id")
    @ApiOperation({ summary: "Driver details" })
    @Roles(UserRole.ADMIN)
    async driverDetails(@Param("id") id: string) {
        const result = await this.adminService.getDriverDetailsFromDB(id);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }

    @Patch("driver-approval")
    @ApiOperation({ summary: "Accept/reject driver account" })
    @Roles(UserRole.ADMIN)
    async acceptRejectDriverAccount(@Body() payload: AcceptRejectAccountDto) {
        const result =
            await this.adminService.acceptRejectDriverAccount(payload);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
        });
    }

    @Get("all-buyers")
    @ApiOperation({ summary: "All buyers" })
    @Roles(UserRole.ADMIN)
    async allBuyers(@Query() query: BaseUserQueryDto) {
        const result = await this.adminService.getAllBuyerFromDB(query);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }

    @Get("buyer-details/:id")
    @ApiOperation({ summary: "Buyer details" })
    @Roles(UserRole.ADMIN)
    async buyerDetails(@Param("id") id: string) {
        const result = await this.adminService.getBuyerDetailsFromDB(id);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }

    @Post("create-category")
    @ApiOperation({ summary: "Create new category" })
    @IsPublic()
    // @Roles(UserRole.ADMIN)
    @UseInterceptors(
        CustomFileInterceptor("imageUrl"),
        ParseFormDataInterceptor,
    )
    async createNewCategory(
        @Body() payload: CategoryDto,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        const result = await this.adminService.createNewCategory(payload, file);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
        });
    }

    @Get("all-categories")
    @ApiOperation({ summary: "All categories" })
    @IsPublic()
    async allCategories() {
        const result = await this.adminService.getAllCategories();

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }

    @Patch("toggle-category-status/:id")
    @ApiOperation({ summary: "Toggle category status" })
    @Roles(UserRole.ADMIN)
    async toggleCategoryStatus(@Param("id") id: string) {
        const result = await this.adminService.toggleCategoryStatus(id);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
        });
    }

    @Get("all-orders")
    @ApiOperation({ summary: "All orders" })
    @Roles(UserRole.ADMIN)
    async allOrders(@Query() query: OrderQueryDto) {
        const result = await this.adminService.getAllOrdersFromDB(query);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }

    @Get("order-details/:id")
    @ApiOperation({ summary: "Order details" })
    @Roles(UserRole.ADMIN)
    async orderDetails(@Param("id") id: string) {
        const result = await this.adminService.getOrderDetailsFromDB(id);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }

    @IsPublic()
    @Post("assign-driver")
    @ApiOperation({ summary: "Assign driver to delivery" })
    @Roles(UserRole.ADMIN)
    async assignDriverToDelivery(@Body() payload: AssignDriverDto) {
        const result = await this.adminService.assignDriverToDelivery(payload);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
        });
    }

    @Get("all-producer-earnings")
    @ApiOperation({ summary: "All producer earnings" })
    @Roles(UserRole.ADMIN)
    async allProducerEarnings(@Query() query: EarningQueryDto) {
        const result = await this.adminService.getAllProducerEarnings(query);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }

    @Get("all-driver-earnings")
    @ApiOperation({ summary: "All driver earnings" })
    @Roles(UserRole.ADMIN)
    async allDriverEarnings(@Query() query: EarningQueryDto) {
        const result = await this.adminService.getAllDriverEarnings(query);

        return ResponseService.formatResponse({
            statusCode: HttpStatus.OK,
            message: result.message,
            data: result.data,
        });
    }
}

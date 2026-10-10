import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import {  Queue } from "bullmq";

export const EARNINGS_QUEUE = "earnings-transfers";
// export const TRANSFER_DELAY = 24 * 60 * 60 * 1000;
export const TRANSFER_DELAY = 2 * 60 * 1000; // 2 minutes

export type TransferJobData =
    | { type: "producer"; earningId: string }
    | { type: "driver"; earningId: string };

@Injectable()
export class PaymentQueueService {
    constructor(
        @InjectQueue(EARNINGS_QUEUE)
        private readonly queue: Queue<TransferJobData>,
    ) {}

    async scheduleProducerTransfer(earningId: string) {
        await this.addTransferJob("producer", earningId);
    }

    async scheduleDriverTransfer(earningId: string) {
        await this.addTransferJob("driver", earningId);
    }

    async cancelProducerTransfer(earningId: string) {
        await this.removeJob(`producer-transfer-${earningId}`);
    }

    async cancelDriverTransfer(earningId: string) {
        await this.removeJob(`driver-transfer-${earningId}`);
    }

    private async addTransferJob(
        type: TransferJobData["type"],
        earningId: string,
    ) {
        console.log("added in queue")
        await this.queue.add(
            `${type}-transfer`,
            { type, earningId },
            {
                jobId: `${type}-transfer-${earningId}`,
                delay: TRANSFER_DELAY,
                attempts: 3,
                backoff: { type: "exponential", delay: 60_000 },
                removeOnComplete: true,
                removeOnFail: false,
            },
        );
    }

    private async removeJob(jobId: string) {
        const job = await this.queue.getJob(jobId);
        if (job) await job.remove();
    }
}

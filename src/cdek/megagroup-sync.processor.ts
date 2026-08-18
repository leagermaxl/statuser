import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MegagroupService } from '../megagroup/megagroup.service';
import { OrderStatusAttributesDto } from './dto/webhook/order-status-attributes.dto';

@Processor('megagroup-sync')
export class MegagroupSyncProcessor extends WorkerHost {
	private readonly logger = new Logger(MegagroupSyncProcessor.name);

	constructor(private readonly megagroupService: MegagroupService) {
		super();
	}

	async process(
		job: Job<Pick<OrderStatusAttributesDto, 'cdek_number' | 'number' | 'code'>, any, string>,
	): Promise<any> {
		if (job.name === 'update-status') {
			const { cdek_number, number, code } = job.data;

			this.logger.log(
				`[START] Начало синхронизации заказа ${number} (${cdek_number}) -> ${code}`,
			);

			try {
				await this.megagroupService.updateOrderStatus(cdek_number, number, code);

				this.logger.log(`[SUCCESS] Заказ ${number} успешно обновлен в Megagroup`);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				const attempts = job.opts.attempts ?? 1;

				this.logger.error(
					`[ERROR] Ошибка обновления заказа ${number} (${cdek_number}), ` +
						`попытка ${job.attemptsMade}/${attempts}: ${errorMessage}`,
				);

				if (job.attemptsMade >= attempts) {
					this.logger.error(
						`[FAILED] Заказ ${number} (${cdek_number}) не синхронизирован с Megagroup ` +
							`после ${attempts} попыток — требуется ручное вмешательство`,
					);
				}

				throw error;
			}
		}
	}
}

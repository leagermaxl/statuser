import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MegagroupService } from '../megagroup/megagroup.service';
import { OrderStatusAttributesDto } from './dto/webhook/order-status-attributes.dto';

/**
 * drainDelay/stalledInterval заметно снижены по частоте относительно дефолтов
 * BullMQ (5с / 30с) — при пустой очереди воркер и так почти всегда пуст (заказы
 * прилетают редко), а дефолты на бесплатном Upstash (лимит 500k команд/мес)
 * сжигают весь месячный лимит одним только фоновым опросом холостой очереди.
 * На задержку реальной обработки это не влияет: блокирующий pop будит воркер
 * сразу при добавлении джобы, а не ждёт истечения drainDelay.
 */
@Processor('megagroup-sync', { drainDelay: 60, stalledInterval: 120_000 })
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

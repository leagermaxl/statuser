import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { CdekController } from './cdek.controller';
import { CdekService } from './cdek.service';
import { OrderStatusWebhookDto } from './dto/webhook/order-status-webhook.dto';
import { CdekWebhookSignatureGuard } from './guards/cdek-webhook-signature.guard';

function makeWebhookPayload(code: string): OrderStatusWebhookDto {
	return {
		type: 'ORDER_STATUS',
		date_time: '2026-01-01T00:00:00+0000',
		uuid: 'uuid-1',
		attributes: {
			is_return: false,
			is_reverse: false,
			is_client_return: false,
			cdek_number: 'cdek-1',
			number: 'ORDER-42',
			related_entities: [],
			code,
			status_code: '3',
			status_date_time: '2026-01-01T00:00:00+0000',
			city_name: 'Москва',
			city_code: '44',
			deleted: false,
		},
	} as unknown as OrderStatusWebhookDto;
}

describe('CdekController', () => {
	let controller: CdekController;
	let syncQueue: { add: jest.Mock };

	beforeEach(async () => {
		syncQueue = { add: jest.fn().mockResolvedValue(undefined) };

		const module: TestingModule = await Test.createTestingModule({
			controllers: [CdekController],
			providers: [
				{ provide: CdekService, useValue: {} },
				{ provide: getQueueToken('megagroup-sync'), useValue: syncQueue },
				AdminAuthGuard,
				CdekWebhookSignatureGuard,
				{
					provide: ConfigService,
					useValue: { getOrThrow: jest.fn().mockReturnValue('unused') },
				},
			],
		}).compile();

		controller = module.get(CdekController);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('ставит джобу в очередь для финального статуса (DELIVERED)', async () => {
		await expect(controller.webhookHandler(makeWebhookPayload('DELIVERED'))).resolves.toEqual({
			status: 'success',
		});

		expect(syncQueue.add).toHaveBeenCalledWith(
			'update-status',
			{ cdek_number: 'cdek-1', number: 'ORDER-42', code: 'DELIVERED' },
			expect.objectContaining({ removeOnComplete: true }),
		);
	});

	it('не ставит джобу в очередь для нефинального статуса (RECEIVED_AT_SHIPMENT_WAREHOUSE)', async () => {
		await expect(
			controller.webhookHandler(makeWebhookPayload('RECEIVED_AT_SHIPMENT_WAREHOUSE')),
		).resolves.toEqual({ status: 'success' });

		expect(syncQueue.add).not.toHaveBeenCalled();
	});
});

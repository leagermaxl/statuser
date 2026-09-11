import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { OrderStatusAttributesDto } from './dto/webhook/order-status-attributes.dto';
import { MegagroupService } from '../megagroup/megagroup.service';
import { MegagroupSyncProcessor } from './megagroup-sync.processor';

type SyncJob = Job<
	Pick<OrderStatusAttributesDto, 'cdek_number' | 'number' | 'code'>,
	unknown,
	string
>;

function makeJob(
	overrides: { name?: string; attemptsMade?: number; attempts?: number } = {},
): SyncJob {
	return {
		name: overrides.name ?? 'update-status',
		data: { cdek_number: 'cdek-1', number: 'ORDER-42', code: 'DELIVERED' },
		attemptsMade: overrides.attemptsMade ?? 1,
		opts: { attempts: overrides.attempts ?? 3 },
	} as unknown as SyncJob;
}

describe('MegagroupSyncProcessor', () => {
	let processor: MegagroupSyncProcessor;
	let megagroupService: { updateOrderStatus: jest.Mock };
	let logSpy: jest.SpyInstance;
	let errorSpy: jest.SpyInstance;

	beforeEach(async () => {
		megagroupService = { updateOrderStatus: jest.fn() };
		logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				MegagroupSyncProcessor,
				{ provide: MegagroupService, useValue: megagroupService },
			],
		}).compile();

		processor = module.get(MegagroupSyncProcessor);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('игнорирует джобы с именем, отличным от update-status', async () => {
		await processor.process(makeJob({ name: 'some-other-job' }));

		expect(megagroupService.updateOrderStatus).not.toHaveBeenCalled();
	});

	it('вызывает updateOrderStatus с полями из джобы', async () => {
		megagroupService.updateOrderStatus.mockResolvedValue(true);

		await processor.process(makeJob());

		expect(megagroupService.updateOrderStatus).toHaveBeenCalledWith(
			'cdek-1',
			'ORDER-42',
			'DELIVERED',
		);
	});

	it('логирует SUCCESS, если Megagroup реально обновился (updateOrderStatus -> true)', async () => {
		megagroupService.updateOrderStatus.mockResolvedValue(true);

		await processor.process(makeJob());

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('[SUCCESS] Заказ ORDER-42 успешно обновлен в Megagroup'),
		);
	});

	it('логирует SKIPPED, а не SUCCESS, если статус нефинальный (updateOrderStatus -> false)', async () => {
		megagroupService.updateOrderStatus.mockResolvedValue(false);

		await processor.process(makeJob());

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[SKIPPED] Заказ ORDER-42'));
		expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('[SUCCESS]'));
	});

	it('пробрасывает ошибку дальше (для retry BullMQ), если updateOrderStatus упал', async () => {
		megagroupService.updateOrderStatus.mockRejectedValue(new Error('boom'));

		await expect(processor.process(makeJob())).rejects.toThrow('boom');
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
	});

	it('логирует FAILED, когда исчерпаны все попытки retry', async () => {
		megagroupService.updateOrderStatus.mockRejectedValue(new Error('boom'));

		await expect(processor.process(makeJob({ attemptsMade: 3, attempts: 3 }))).rejects.toThrow(
			'boom',
		);

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[FAILED]'));
	});
});

import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { HealthPingService } from './health-ping.service';

describe('HealthPingService', () => {
	let httpService: { get: jest.Mock };
	let configService: { get: jest.Mock };
	const originalRenderUrl = process.env.RENDER_EXTERNAL_URL;

	async function createService(): Promise<HealthPingService> {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				HealthPingService,
				{ provide: HttpService, useValue: httpService },
				{ provide: ConfigService, useValue: configService },
			],
		}).compile();

		return module.get(HealthPingService);
	}

	beforeEach(() => {
		jest.useFakeTimers();
		httpService = { get: jest.fn() };
		configService = { get: jest.fn() };
		delete process.env.RENDER_EXTERNAL_URL;
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.clearAllMocks();
		if (originalRenderUrl === undefined) {
			delete process.env.RENDER_EXTERNAL_URL;
		} else {
			process.env.RENDER_EXTERNAL_URL = originalRenderUrl;
		}
	});

	it('не пингует, если не задан ни SELF_URL, ни RENDER_EXTERNAL_URL', async () => {
		configService.get.mockReturnValue(undefined);

		const service = await createService();
		service.onApplicationBootstrap();
		jest.advanceTimersByTime(10 * 60 * 1000);

		expect(httpService.get).not.toHaveBeenCalled();
	});

	it('использует SELF_URL, если он задан', async () => {
		configService.get.mockReturnValue('https://from-config.example.com/');
		process.env.RENDER_EXTERNAL_URL = 'https://from-render.example.com';
		httpService.get.mockReturnValue(of({ data: { status: 'ok' } }));

		const service = await createService();
		service.onApplicationBootstrap();
		jest.advanceTimersByTime(10 * 60 * 1000);

		expect(httpService.get).toHaveBeenCalledWith('https://from-config.example.com/health');
	});

	it('падает обратно на RENDER_EXTERNAL_URL, если SELF_URL не задан', async () => {
		configService.get.mockReturnValue(undefined);
		process.env.RENDER_EXTERNAL_URL = 'https://from-render.example.com';
		httpService.get.mockReturnValue(of({ data: { status: 'ok' } }));

		const service = await createService();
		service.onApplicationBootstrap();
		jest.advanceTimersByTime(10 * 60 * 1000);

		expect(httpService.get).toHaveBeenCalledWith('https://from-render.example.com/health');
	});

	it('пингует раз в 10 минут и не падает при ошибке запроса', async () => {
		configService.get.mockReturnValue('https://app.example.com');
		httpService.get.mockReturnValue(throwError(() => new Error('network error')));

		const service = await createService();
		service.onApplicationBootstrap();

		jest.advanceTimersByTime(10 * 60 * 1000);
		await Promise.resolve();
		jest.advanceTimersByTime(10 * 60 * 1000);
		await Promise.resolve();

		expect(httpService.get).toHaveBeenCalledTimes(2);
	});

	it('останавливает пинги после onModuleDestroy', async () => {
		configService.get.mockReturnValue('https://app.example.com');
		httpService.get.mockReturnValue(of({ data: { status: 'ok' } }));

		const service = await createService();
		service.onApplicationBootstrap();
		service.onModuleDestroy();
		jest.advanceTimersByTime(60 * 60 * 1000);

		expect(httpService.get).not.toHaveBeenCalled();
	});
});

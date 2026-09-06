import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * Бесплатный веб-сервис на Render засыпает примерно после 15 минут без входящего
 * HTTP-трафика через публичный урл — трафик именно "снаружи", localhost внутри
 * контейнера не считается. Поэтому раз в 10 минут дёргаем свой же /health по
 * внешнему адресу, а не вызываем HealthController напрямую в процессе.
 *
 * Урл берём из SELF_URL, а если не задан — из RENDER_EXTERNAL_URL (Render сам
 * прокидывает эту переменную в каждый веб-сервис). Если нет ни того ни другого
 * (например, локальная разработка) — просто не пингуем, без падения приложения.
 */
@Injectable()
export class HealthPingService implements OnApplicationBootstrap, OnModuleDestroy {
	private readonly logger = new Logger(HealthPingService.name);
	private readonly PING_INTERVAL_MS = 10 * 60 * 1000;
	private timer?: NodeJS.Timeout;

	constructor(
		private readonly httpService: HttpService,
		private readonly configService: ConfigService,
	) {}

	onApplicationBootstrap(): void {
		const healthUrl = this.resolveHealthUrl();

		if (!healthUrl) {
			this.logger.warn(
				'Self-ping не запущен: не задан ни SELF_URL, ни RENDER_EXTERNAL_URL — ' +
					'на бесплатном Render сервис будет засыпать при простое',
			);
			return;
		}

		this.logger.log(
			`Self-ping запущен: ${healthUrl} каждые ${this.PING_INTERVAL_MS / (60 * 1000)} минут`,
		);
		this.timer = setInterval(() => void this.ping(healthUrl), this.PING_INTERVAL_MS);
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	private resolveHealthUrl(): string | undefined {
		const baseUrl =
			this.configService.get<string>('SELF_URL') ?? process.env.RENDER_EXTERNAL_URL;

		return baseUrl ? `${baseUrl.replace(/\/+$/, '')}/health` : undefined;
	}

	private async ping(healthUrl: string): Promise<void> {
		try {
			await firstValueFrom(this.httpService.get(healthUrl));
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.warn(`Self-ping ${healthUrl} не удался: ${errorMessage}`);
		}
	}
}

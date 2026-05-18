import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust Railway's proxy so req.ip resolves to the real client (X-Forwarded-For)
  // — required for IP-based throttling to be meaningful behind a load balancer.
  app.set('trust proxy', 1);

  // CSP is disabled because /privacy, /terms, /support are server-rendered HTML
  // with inline <style>; the rest of the API is JSON where CSP adds little value.
  // All other helmet defaults stay on (X-Content-Type-Options, X-Frame-Options,
  // HSTS, Referrer-Policy, etc.).
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());

  const logger = new Logger('HTTP');
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`;
      if (res.statusCode >= 500) logger.error(line);
      else if (res.statusCode >= 400) logger.warn(line);
      else logger.log(line);
    });
    next();
  });

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();

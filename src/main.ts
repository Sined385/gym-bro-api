import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new AppExceptionFilter());

  const logger = new Logger('HTTP');
  app.use((req, res, next) => {
    const start = Date.now();
    const chunks: Buffer[] = [];
    const origWrite = res.write;
    const origEnd = res.end;
    res.write = function (chunk: any, ...args: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return origWrite.apply(res, [chunk, ...args]);
    };
    res.end = function (chunk: any, ...args: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8');
      const ms = Date.now() - start;
      if (res.statusCode >= 400) {
        logger.warn(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms body=${JSON.stringify(req.body)} resp=${body}`);
      } else {
        logger.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
      }
      return origEnd.apply(res, [chunk, ...args]);
    };
    next();
  });
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();

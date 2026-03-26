import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppException } from '../exceptions/app.exception';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof AppException) {
      const body = exception.getResponse() as { code: string; message: string };
      return response
        .status(exception.getStatus())
        .json({ error: { code: body.code, message: body.message } });
    }

    if (exception instanceof UnauthorizedException) {
      return response.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'not_authenticated',
          message: 'Missing or invalid authorization token',
        },
      });
    }

    if (exception instanceof NotFoundException) {
      return response.status(HttpStatus.NOT_FOUND).json({
        error: { code: 'not_found', message: 'Resource not found' },
      });
    }

    if (exception instanceof HttpException) {
      return response.status(exception.getStatus()).json({
        error: { code: 'server_error', message: exception.message },
      });
    }

    // Log unhandled errors so they appear in Railway logs
    this.logger.error(
      `${request.method} ${request.url} — ${exception instanceof Error ? exception.message : exception}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'server_error', message: 'Internal server error' },
    });
  }
}

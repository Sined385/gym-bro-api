import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { AppException } from '../exceptions/app.exception';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

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

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'server_error', message: 'Internal server error' },
    });
  }
}

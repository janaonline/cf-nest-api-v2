import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: unknown = undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp['message'] as string) ?? message;
        if (resp['errors']) errors = resp['errors'];
      }
    } else if (exception instanceof Error) {
      if (exception.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Access token expired';
      } else if (exception.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid token';
      } else {
        const exCode = (exception as { code?: unknown }).code;
        if (exCode === 11000) {
          statusCode = 409;
          message = 'Resource already exists';
        }
      }
    }

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: Record<string, unknown> = {
      statusCode,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
    if (errors !== undefined) body['errors'] = errors;

    response.status(statusCode).json(body);
  }
}

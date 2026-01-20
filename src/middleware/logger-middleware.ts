import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const startTime = process.hrtime(); // High-resolution timer

    res.on('finish', () => {
      const diff = process.hrtime(startTime);
      const timeTakenMs = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2); // Convert to milliseconds

      console.log(`Method: ${req.method}`);
      console.log(`Endpoint: ${req.originalUrl}`);
      console.log(`Status: ${res.statusCode}`);
      console.log(`Time:   ${timeTakenMs} ms`);
      console.log(`-`);
    });

    next();
  }
}

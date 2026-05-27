import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost(
  reqOverrides: Partial<{ url: string; method: string; headers: Record<string, string> }> = {},
) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const req = {
    url: reqOverrides.url ?? '/api/test',
    method: reqOverrides.method ?? 'POST',
    headers: reqOverrides.headers ?? {},
  };
  const host: ArgumentsHost = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
      getNext: () => undefined,
    }),
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ArgumentsHost;
  return { host, res, req };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('shapes a BadRequestException as BAD_REQUEST with message', () => {
    const { host, res } = makeHost();
    filter.catch(new BadRequestException('invalid email'), host);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error).toEqual({ code: 'BAD_REQUEST', message: 'invalid email' });
    expect(body.path).toBe('/api/test');
    expect(typeof body.requestId).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });

  it('lifts class-validator message array into details', () => {
    const { host, res } = makeHost();
    const ex = new BadRequestException({
      statusCode: 400,
      message: ['email must be an email', 'password must be at least 8 chars'],
      error: 'Bad Request',
    });
    filter.catch(ex, host);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('validation failed');
    expect(body.error.details).toEqual([
      'email must be an email',
      'password must be at least 8 chars',
    ]);
  });

  it.each([
    [new UnauthorizedException('nope'), 401, 'UNAUTHORIZED'],
    [new ForbiddenException('nope'), 403, 'FORBIDDEN'],
    [new NotFoundException('nope'), 404, 'NOT_FOUND'],
    [new ConflictException('nope'), 409, 'CONFLICT'],
  ])('maps %s correctly', (ex, status, code) => {
    const { host, res } = makeHost();
    filter.catch(ex, host);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json.mock.calls[0][0].error.code).toBe(code);
  });

  it('returns INTERNAL_ERROR 500 for unknown throws', () => {
    const { host, res } = makeHost();
    filter.catch(new Error('boom'), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('boom');
  });

  it('honors a client-supplied x-request-id header', () => {
    const { host, res } = makeHost({ headers: { 'x-request-id': 'rid-abc' } });
    filter.catch(new BadRequestException('x'), host);
    expect(res.json.mock.calls[0][0].requestId).toBe('rid-abc');
  });

  it('generates a uuid request id when header missing', () => {
    const { host, res } = makeHost();
    filter.catch(new BadRequestException('x'), host);
    const rid = res.json.mock.calls[0][0].requestId;
    expect(rid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('handles HttpException constructed with a string body', () => {
    const { host, res } = makeHost();
    filter.catch(new HttpException('teapot', 418), host);
    expect(res.status).toHaveBeenCalledWith(418);
    const body = res.json.mock.calls[0][0];
    expect(body.error.message).toBe('teapot');
    expect(body.error.code).toBe('HTTP_418');
  });
});

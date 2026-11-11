/** Domain / RPC errors thrown by services (and still by db helpers during Phase 3). */

export class DomainRpcError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

export class DiagnosticContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "DiagnosticContractError";
  }
}

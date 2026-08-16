// @ts-check

export class ProjectRegistry {
  constructor(bindings, metadata) {
    this.bindings = Object.freeze(bindings.map((binding) => Object.freeze({ ...binding })));
    this.metadata = Object.freeze({ ...metadata });
    this.byChannel = new Map(this.bindings.map((binding) => [binding.channelId, binding]));
  }

  resolve(channelId) {
    return this.byChannel.get(channelId) ?? null;
  }

  publicSummary() {
    return {
      schemaVersion: 1,
      authority: this.metadata.authority,
      sourceRepository: this.metadata.sourceRepository,
      sourceRef: this.metadata.sourceRef,
      sourceCommit: this.metadata.sourceCommit,
      canonicalSha256: this.metadata.digest,
      bindingCount: this.bindings.length,
      routes: this.bindings.map((binding) => ({
        channelId: binding.channelId,
        linearProjectId: binding.linearProjectId,
        repository: binding.repository,
        defaultAgentMode: binding.defaultAgentMode,
        writePolicy: binding.writePolicy
      }))
    };
  }
}

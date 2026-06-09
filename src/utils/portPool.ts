import * as net from "net"

export class PortPool {
  private readonly reserved = new Set<number>()
  private readonly basePort: number
  private readonly maxPorts: number
  private nextCandidate: number
  constructor(basePort = 15000, maxPorts = 100) {
    this.basePort = basePort; this.maxPorts = maxPorts; this.nextCandidate = basePort
  }
  async reserve(): Promise<number> {
    for (let i = 0; i < this.maxPorts; i++) {
      const port = this.nextCandidate
      this.nextCandidate = this.nextCandidate >= this.basePort + this.maxPorts - 1 ? this.basePort : this.nextCandidate + 1
      if (this.reserved.has(port)) continue
      if (await this.isPortAvailable(port)) { this.reserved.add(port); return port }
    }
    throw new Error(`PortPool: no free port in ${this.basePort}-${this.basePort + this.maxPorts - 1}`)
  }
  release(port: number): void { this.reserved.delete(port) }
  get size(): number { return this.reserved.size }
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer(); server.unref()
      server.on("error", () => resolve(false))
      server.listen(port, "127.0.0.1", () => { server.close(() => resolve(true)) })
    })
  }
}

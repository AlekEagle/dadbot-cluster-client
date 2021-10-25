import EventEmitter from 'events';
import Clients, { ClientOptions } from './clients';
import { ClientService, GenericOptions } from './types';

export let __Schema: any;

export const defaultOptions: GenericOptions = {
  cluster: { count: -1, id: -1 }
};

export default class Client<
  C extends keyof typeof Clients,
  O extends ClientOptions[C]
> extends EventEmitter {
  private clientService: ClientService;
  constructor(
    protocol:
      | C
      | {
          name: C;
          options?: O;
        },
    token: string,
    schema: any,
    options: GenericOptions
  ) {
    super();
    __Schema = schema;
    if (typeof protocol === 'string')
      this.clientService = new Clients[protocol](token, options, null);
    else
      this.clientService = new Clients[protocol.name](
        token,
        options,
        protocol.options
      );

    this.clientService.on('CCCQuery', (data, cb) =>
      this.emit('CCCQuery', data, cb)
    );
    this.clientService.on('cluster_status', (...args) =>
      this.emit('cluster_status', ...args)
    );
    this.clientService.on('connected', () => this.emit('connected'));
    this.clientService.on('data_pushed', () => this.emit('data_pushed'));
    this.clientService.on('disconnected', code =>
      this.emit('disconnected', code)
    );
  }

  public connect() {
    this.clientService.connect();
  }
  public startCCC(to: number | 'all', data: string) {
    return this.clientService.startCCC(to, data);
  }
}

import EventEmitter from 'events';
import Clients, { ClientOptions } from './clients';
import { ClientService, GenericOptions } from './types';

export let __Schema: any;

class Client<
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
    options?: GenericOptions
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
  }
}

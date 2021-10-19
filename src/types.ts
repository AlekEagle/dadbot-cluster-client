import EventEmitter from 'node:events';

export declare interface Data {
  type: 0 | 1 | 2;
  data: any;
}

export declare enum GenericCloseCodes {
  ServerRestarting,
  InvalidData,
  ServerError,
  NotReadyForData
}

export declare interface Events {
  connected: () => void;
  disconnected: (code: number | Error) => void;
  CCCQuery: (data: string, cb: (output: string) => void) => void;
}

export declare interface GenericOptions {
  cluster: {
    count: number;
    id: number;
  };
}

export declare interface Constructable<T> {
  new (...args: any): T;
}

export declare class ClientService extends EventEmitter {
  on<U extends keyof Events>(event: U, listener: Events[U]): this;
  once<U extends keyof Events>(event: U, listener: Events[U]): this;
  off<U extends keyof Events>(event: U, listener: Events[U]): this;
  addListener<U extends keyof Events>(event: U, listener: Events[U]): this;
  serviceOptions: any;
  options: GenericOptions;
  emit<U extends keyof Events>(
    event: U,
    ...args: Parameters<Events[U]>
  ): boolean;
  name: string;
  sendData(type: 0 | 1 | 2, data: any): Promise<void>;
  disconnect(code: GenericCloseCodes): void;
  startCCC(
    to: number | 'all',
    data: string
  ): Promise<{ id: string; data: string | string[] }>;
  connect(): Promise<void>;
}

import EventEmitter from 'node:events';

export enum DataTypes {
  ClusterData = 0,
  Log = 1,
  Error = 2
}

export declare interface Data {
  type: DataTypes;
  data: any;
}

export enum GenericCloseCodes {
  OK,
  ClientError
}

export declare interface Events {
  connected: () => void;
  disconnected: (code: number | Error) => void;
  cluster_status: (count: number, connected: number[]) => void;
  CCCQuery: (data: string, cb: (output: string) => void) => void;
  data_pushed: () => void;
}

export declare interface GenericOptions {
  cluster: {
    count: number;
    id: number;
  };
  reconnect?: boolean;
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
  sendData(type: DataTypes, data: any): Promise<boolean>;
  disconnect(code: GenericCloseCodes): void;
  startCCC(
    to: number | 'all',
    data: string
  ): Promise<{ id: string; data: string | string[] }>;
  connect(): Promise<void>;
}

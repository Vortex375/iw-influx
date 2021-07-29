import { Service, State } from 'iw-base/lib/registry';
import * as logging from 'iw-base/lib/logging';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { Component, Inject, Scoped } from 'iw-ioc';
import { Record } from '@deepstream/client/dist/src/record/record';
import { ChildProcess, spawn } from 'child_process';
import * as readline from 'readline';
import { InfluxDB } from 'influx';
import { map, mapValues, template, TemplateExecutor } from 'lodash';

const log = logging.getLogger('InfluxdbWriter');


export interface InfluxdbWriterConfig {
  recordName: string;
  url: string;
  measurement: string;
  tags?: { [key: string]: string }
  fields: { [key: string]: string }
  timestamp?: string;
}

@Component('influxdb-writer')
@Scoped()
@Inject([IwDeepstreamClient])
export class InfluxdbWriter extends Service {

  private record: Record;
  private influxdb: InfluxDB;

  private measurement: string;
  private tagTemplates: { [key: string] : TemplateExecutor };
  private fieldTemplates: { [key: string] : TemplateExecutor };
  private timestampTemplate: TemplateExecutor | undefined;

  constructor(private ds: IwDeepstreamClient) {
    super('influxdb-writer');
  }

  async start(config: InfluxdbWriterConfig) {
    this.record = this.ds.getRecord(config.recordName);
    this.influxdb = new InfluxDB(config.url);

    this.measurement = config.measurement;
    this.tagTemplates = mapValues(config.tags ?? {}, value => template(value));
    this.fieldTemplates = mapValues(config.fields ?? {}, value => template(value));
    this.timestampTemplate = config.timestamp ? template(config.timestamp) : undefined;

    this.record.subscribe(async (data) => {
      this.setState(State.BUSY, 'writing datapoints');
      try {
        const point = {
          tags: mapValues(this.tagTemplates, tpl => tpl({data})),
          fields: mapValues(this.fieldTemplates, tpl => +tpl({data})),
          timestamp: this.timestampTemplate ? +this.timestampTemplate({data}) : undefined
        }
        log.debug(point, 'writing datapoint');
        await this.influxdb.writeMeasurement(this.measurement, [point]);
        this.setState(State.OK);
      } catch (err) {
        log.error(err, 'failed to write data points');
        this.setState(State.ERROR, 'unable to write to database');
      }
    }, true);

    this.setState(State.OK);
  }

  async stop() {
    if (this.record) {
      this.record.discard();
    }
    this.setState(State.INACTIVE);
  }
}

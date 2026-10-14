import { Controller, Get } from '@nestjs/common';

import { Public } from '../../common/auth/public.decorator';
import { HealthService } from './health.service';

/** Public by design: container orchestrators and uptime probes have no token. */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  liveness() {
    return this.health.liveness();
  }

  @Get('db')
  readiness() {
    return this.health.readiness();
  }
}

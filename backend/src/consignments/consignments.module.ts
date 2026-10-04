import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Consignment } from '../entities/consignment.entity';
import { User } from '../entities/user.entity';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SellerRiskService } from '../risk/risk.module';

class CreateConsignmentDto {
  category: string;
  brand: string;
  sizeText: string;
  material: string;
  yearsUsed: number;
  defectPhotos?: string[];
  disassemblable: boolean;
  floor: number;
  elevator: string;
  expectedPrice: number;
  acceptRefurbish: boolean;
  address?: string;
  sellerNote?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('consignments')
export class ConsignmentController {
  constructor(
    @InjectRepository(Consignment)
    private readonly repo: Repository<Consignment>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly risk: SellerRiskService,
  ) {}

  /** 卖家提交寄卖申请；系统引用历史画像决定验真等级 */
  @Roles('SELLER')
  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateConsignmentDto,
  ) {
    if (
      !dto.category ||
      !dto.brand ||
      !dto.sizeText ||
      !dto.material ||
      dto.expectedPrice == null
    ) {
      throw new BadRequestException('品类、品牌、尺寸、材质、期望售价为必填');
    }
    const profile = await this.risk.getOrCreate(user.sub);
    const count = await this.repo.count();
    const consignment = this.repo.create({
      code: `CN${new Date().getFullYear()}${String(count + 1).padStart(5, '0')}`,
      sellerId: user.sub,
      category: dto.category as any,
      brand: dto.brand,
      sizeText: dto.sizeText,
      material: dto.material,
      yearsUsed: Number(dto.yearsUsed) || 0,
      defectPhotos: dto.defectPhotos || [],
      disassemblable: !!dto.disassemblable,
      floor: Number(dto.floor) || 1,
      elevator: (dto.elevator || 'ELEVATOR') as any,
      expectedPrice: String(dto.expectedPrice),
      acceptRefurbish: !!dto.acceptRefurbish,
      address: dto.address || '',
      sellerNote: dto.sellerNote || '',
      status: 'SUBMITTED',
      verificationLevel: profile.verificationLevel,
    });
    await this.repo.save(consignment);
    return { consignment, sellerProfile: profile };
  }

  /** 列表：卖家看自己的，估价师/运营/客服看全部（可按状态过滤） */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    const where: any = {};
    if (status) where.status = status;
    if (user.role === 'SELLER') {
      where.sellerId = user.sub;
    } else if (sellerId) {
      where.sellerId = sellerId;
    }
    const rows = await this.repo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    const sellerIds = Array.from(new Set(rows.map((r) => r.sellerId)));
    const sellers = sellerIds.length
      ? await this.users.find({ where: sellerIds.map((id) => ({ id })) })
      : [];
    const sellerMap = new Map(sellers.map((s) => [s.id, s]));
    return rows.map((r) => ({
      ...r,
      sellerName: sellerMap.get(r.sellerId)?.name || '-',
    }));
  }

  @Get(':id')
  async detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('寄卖申请不存在');
    if (user.role === 'SELLER' && row.sellerId !== user.sub) {
      throw new ForbiddenException('只能查看自己的寄卖申请');
    }
    const seller = await this.users.findOne({ where: { id: row.sellerId } });
    const profile = await this.risk.getOrCreate(row.sellerId);
    return { ...row, sellerName: seller?.name, sellerProfile: profile };
  }

  /** 估价师预约上门 */
  @Roles('APPRAISER', 'OPS')
  @Post(':id/schedule')
  async schedule(@Param('id') id: string) {
    const row = await this.findOneOrFail(id);
    if (!['SUBMITTED', 'APPRAISAL_SCHEDULED'].includes(row.status)) {
      throw new BadRequestException(`当前状态 ${row.status} 不可预约上门`);
    }
    row.status = 'APPRAISAL_SCHEDULED';
    return this.repo.save(row);
  }

  /** 卖家临时反悔：已约估价或已上架后撤销，计入画像 */
  @Roles('SELLER')
  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const row = await this.findOneOrFail(id);
    if (row.sellerId !== user.sub) {
      throw new ForbiddenException('只能撤销自己的寄卖申请');
    }
    if (['LISTED', 'CANCELLED', 'REJECTED'].includes(row.status)) {
      throw new BadRequestException(
        `状态 ${row.status} 下不可反悔（已成交/已终结请走售后工单）`,
      );
    }
    row.status = 'CANCELLED';
    row.cancelReason = 'SELLER_BACKTRACK';
    row.sellerNote = `${row.sellerNote}\n[卖家反悔] ${body?.reason || '未填写原因'}`.trim();
    await this.repo.save(row);
    const profile = await this.risk.recalculate(user.sub);
    return { consignment: row, sellerProfile: profile };
  }

  private async findOneOrFail(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('寄卖申请不存在');
    return row;
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Consignment, User])],
  controllers: [ConsignmentController],
})
export class ConsignmentModule {}

import { Injectable } from '@nestjs/common';
import { CreateUlbDto } from './dto/create-ulb.dto';
import { UpdateUlbDto } from './dto/update-ulb.dto';

@Injectable()
export class UlbService {
  create(createUlbDto: CreateUlbDto) {
    return 'This action adds a new ulb';
  }

  findAll() {
    return `This action returns all ulb`;
  }

  findOne(id: number) {
    return `This action returns a #${id} ulb`;
  }

  update(id: number, updateUlbDto: UpdateUlbDto) {
    return `This action updates a #${id} ulb`;
  }

  remove(id: number) {
    return `This action removes a #${id} ulb`;
  }
}

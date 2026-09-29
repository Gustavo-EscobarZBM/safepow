import { Injectable } from '@nestjs/common';
import { Brand } from './brand.entity';
import { CatalogTaxonomyService } from './catalog-taxonomy.service';
import { Supplier } from './supplier.entity';

@Injectable()
export class BrandsService extends CatalogTaxonomyService<Brand> {
  constructor() {
    super(Brand, { duplicate: 'Já existe uma marca com este nome.', notFound: 'Marca não encontrada.' });
  }
}

@Injectable()
export class SuppliersService extends CatalogTaxonomyService<Supplier> {
  constructor() {
    super(Supplier, { duplicate: 'Já existe um fornecedor com este nome.', notFound: 'Fornecedor não encontrado.' });
  }
}

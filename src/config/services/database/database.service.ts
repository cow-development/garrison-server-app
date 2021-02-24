import mongoose, { Connection } from 'mongoose';

import { ELogType as logType } from '../../models/log/log.model';
import LoggerService from '../logger/logger.service';

import BannerRepository from '../../../repos/static/banner.repo';
import BuildingRepository from '../../../repos/static/building.repo';
import CharacterRepository from '../../../repos/dynamic/character/character.repo';
import FactionRepository from '../../../repos/static/faction.repo';
import GarrisonRepository from '../../../repos/dynamic/garrison/garrison.repo';
import ResearchRepository from '../../../repos/static/research.repo';
import UnitRepository from '../../../repos/static/unit.repo';
import UserRepository from '../../../repos/dynamic/user/user.repo';
import ZoneRepository from '../../../repos/static/zone.repo';

import {
  DatabaseDynamicType,
  DatabaseStaticType,
  DatabaseType
} from '../../models/data/model';

import bannerSchema from '../../models/data/static/banner/banner.schema';
import buildingSchema from '../../models/data/static/building/building.schema';
import characterSchema from '../../models/data/character/character.schema';
import factionSchema from '../../models/data/static/faction/faction.schema';
import garrisonSchema from '../../models/data/garrison/garrison.schema';
import researchSchema from '../../models/data/static/research/research.schema';
import unitSchema from '../../models/data/static/unit/unit.schema';
import userSchema from '../../models/data/user/user.schema';
import zoneSchema from '../../models/data/static/zone/zone.schema';

import { bannerList } from '../../../store/static/banner.static';
import { buildingList } from '../../../store/static/building.static';
import { factionList } from '../../../store/static/faction.static';
import { researchList } from '../../../store/static/research.static';
import { unitList } from '../../../store/static/unit.static';
import { zoneList } from '../../../store/static/zone.static';

import { IBanner, IBannerDocument, IBannerModel } from '../../models/data/static/banner/banner.types';
import { IBuilding, IBuildingDocument, IBuildingModel } from '../../models/data/static/building/building.types';
import { ICharacterDocument, ICharacterModel } from '../../models/data/character/character.types';
import { IFaction, IFactionDocument, IFactionModel } from '../../models/data/static/faction/faction.types';
import { IGarrisonDocument, IGarrisonModel } from '../../models/data/garrison/garrison.types';
import { IResearch, IResearchDocument, IResearchModel } from '../../models/data/static/research/research.types';
import { IUnit, IUnitDocument, IUnitModel } from '../../models/data/static/unit/unit.types';
import { IUserDocument, IUserModel } from '../../models/data/user/user.types';
import { IZone, IZoneDocument, IZoneModel } from '../../models/data/static/zone/zone.types';

/**
 * Application global database service.
 */
export default class DatabaseService {
  private _dbStaticType: DatabaseStaticType = 'DB_NAME_STATIC';
  private _dbDynamicType: DatabaseDynamicType = 'DB_NAME_DYNAMIC';

  private _connections: Connection[] = [];

  private _logger = new LoggerService(this.constructor.name);

  private _bannerRepo = <BannerRepository>{};
  private _buildingRepo = <BuildingRepository>{};
  private _characterRepo = <CharacterRepository>{};
  private _factionRepo = <FactionRepository>{};
  private _researchRepo = <ResearchRepository>{};
  private _garrisonRepo = <GarrisonRepository>{};
  private _unitRepo = <UnitRepository>{};
  private _userRepo = <UserRepository>{};
  private _zoneRepo = <ZoneRepository>{};

  /** Retrieve statics database. */
  get static() {
    return this._connections.find(co => co.name === process.env.DB_NAME_STATIC);
  }

  /** Retrieve dynamic database. */
  get dynamic() {
    return this._connections.find(co => co.name === process.env.DB_NAME_DYNAMIC);
  }

  /** Retrieve banner repository. */
  get bannerRepo() {
    return this._bannerRepo;
  }

  /** Retrieve building repository. */
  get buildingRepo() {
    return this._buildingRepo;
  }

  /** Retrieve character repository. */
  get characterRepo() {
    return this._characterRepo;
  }

  /** Retrieve faction repository. */
  get factionRepo() {
    return this._factionRepo;
  }

  /** Retrieve garrison repo. */
  get garrisonRepo() {
    return this._garrisonRepo;
  }

  /** Retrieve research repo. */
  get researchRepo() {
    return this._researchRepo;
  }

  /** Retrieve unit repo. */
  get unitRepo() {
    return this._unitRepo;
  }

  /** Retrieve user repository. */
  get userRepo() {
    return this._userRepo;
  }

  /** Retrieve zone repository. */
  get zoneRepo() {
    return this._zoneRepo;
  }

  /**
   * Connect and register all existing databases to the application.
   */
  async connectDatabases() {
    if (!this._connections.find(co => co.name === this._dbStaticType))
      await this._addConnection(this._dbStaticType);

    if (!this._connections.find(co => co.name === this._dbDynamicType))
      await this._addConnection(this._dbDynamicType);

    // init all models after having being connected to the databases
    await this._initAllModels();

    // init all database services
    await this._initAllRepos();
  }

  /**
   * Initialize all database services.
   */
  private async _initAllRepos() {
    // check if both statics and dynamic databases have been initialized
    if (!this.dynamic) throw new Error(`Database \'${this._dbDynamicType}\' hasn\'t been initialized.`);
    if (!this.static) throw new Error(`Database \'${this._dbStaticType}\' hasn\'t been initialized.`);

    // init statics services
    this._bannerRepo = new BannerRepository(this.static);
    this._buildingRepo = new BuildingRepository(this.static);
    this._factionRepo = new FactionRepository(this.static);
    this._researchRepo= new ResearchRepository(this.static);
    this._unitRepo = new UnitRepository(this.static);
    this._zoneRepo = new ZoneRepository(this.static);
    
    // init dynamic services
    this._userRepo = new UserRepository(this.dynamic);
    this._characterRepo = new CharacterRepository(
      this.dynamic,
      this._bannerRepo,
      this._factionRepo,
      this._userRepo
    );
    this._garrisonRepo = new GarrisonRepository(
      this.dynamic,
      this._buildingRepo,
      this._characterRepo,
      this._unitRepo,
      this._userRepo,
      this._zoneRepo
    );
  }

  /**
   * Initialize all database models.
   */
  private async _initAllModels() {
    // starting with statics database...
    this.static?.model<IBannerDocument>('banner', bannerSchema) as IBannerModel;
    this.static?.model<IBuildingDocument>('building', buildingSchema) as IBuildingModel;
    this.static?.model<IFactionDocument>('faction', factionSchema) as IFactionModel;
    this.static?.model<IResearchDocument>('research', researchSchema) as IResearchModel;
    this.static?.model<IUnitDocument>('unit', unitSchema) as IUnitModel;
    this.static?.model<IZoneDocument>('zone', zoneSchema) as IZoneModel;

    // fill the statics database
    await this._fillStatics();

    // ...then with dynamic database
    this.dynamic?.model<ICharacterDocument>('character', characterSchema) as ICharacterModel;
    this.dynamic?.model<IGarrisonDocument>('garrison', garrisonSchema) as IGarrisonModel;
    this.dynamic?.model<IUserDocument>('user', userSchema) as IUserModel;
  }

  /**
   * Fill statics database with the default static data from the store.
   */
  private async _fillStatics() {
    // bind each imported list to its matching imported model
    const lists = [
      { entities: bannerList,
        methods: {
          findByCode: (code: string) => (this.static?.model('banner') as IBannerModel).findByCode(code),
          create: (entity: object) => (this.static?.model('banner') as IBannerModel).create(entity as IBanner)
        }
      },

      { entities: buildingList,
        methods: {
          findByCode: (code: string) => (this.static?.model('building') as IBuildingModel).findByCode(code),
          create: (entity: object) => (this.static?.model('building') as IBuildingModel).create(entity as IBuilding)
        }
      },

      { entities: factionList,
        methods: {
          findByCode: (code: string) => (this.static?.model('faction') as IFactionModel).findByCode(code),
          create: (entity: object) => (this.static?.model('faction') as IFactionModel).create(entity as IFaction)
        }
      },

      { entities: researchList,
        methods: {
          findByCode: (code: string) => (this.static?.model('research') as IResearchModel).findByCode(code),
          create: (entity: object) => (this.static?.model('research') as IResearchModel).create(entity as IResearch)
        }
      },

      { entities: unitList,
        methods: {
          findByCode: (code: string) => (this.static?.model('unit') as IUnitModel).findByCode(code),
          create: (entity: object) => (this.static?.model('unit') as IUnitModel).create(entity as IUnit)
        }
      },
        
      { entities: zoneList,
        methods: {
          findByCode: (code: string) => (this.static?.model('zone') as IZoneModel).findByCode(code),
          create: (entity: object) => (this.static?.model('zone') as IZoneModel).create(entity as IZone)
        }
      },
    ];

    for (const list of lists) {
      // add each entity contained in the list to its matching collection
      // only if it doesn't already exist (of course 🤷‍♂️)
      for (const entity of list.entities) {
        if (await list.methods.findByCode(entity.code)) continue;
        
        this._logger.log(logType.pending, `Creating entity ${entity.code}...`);
        const created = await list.methods.create(entity);
        
        if (created) this._logger.log(logType.pass, `Created entity ${entity.code} (${created.id})`);
        else this._logger.log(logType.fail, `Failed to create entity ${entity.code}`);
      }
    }
  }

  /**
    * Add a new db-typed connection into the service connections.
    * @param dbType Database type.
   */
  private async _addConnection(dbType: DatabaseType) {
    /**
     * Create a new connection using the given database type.
     */
    const createConnection = async (dbType: DatabaseType) => {
      /**
       * Assemble the right URI according to the given database type.
       * @param dbType Database type.
       */
      const retrieveURI = (dbType: DatabaseType) => {
        // make sure the environment variables exist
        if (
          !process.env.DB_URI
          || !process.env[dbType]
          || !process.env.DB_USER_NAME
          || !process.env.DB_USER_PASSWORD
        ) throw new Error('Couldn\'t retrieve either database URI or name, user or password from .env file.');
  
        return process.env.DB_URI
          .replace('<username>', process.env.DB_USER_NAME)
          .replace('<password>', process.env.DB_USER_PASSWORD)
          .replace('<dbname>', process.env[dbType] as string);
      };

      const defaultOptions = {
        useNewUrlParser: true,
        useCreateIndex: true,
        useFindAndModify: false,
        useUnifiedTopology: true
      };

      return await mongoose.createConnection(retrieveURI(dbType), defaultOptions);
    };

    try {
      this._logger.log(logType.pending, `Connecting to database ${dbType}...`);
      this._connections = this._connections.concat(await createConnection(dbType));
      this._logger.log(logType.pass, `Connected to database ${dbType}`);
    } catch (err) {
      this._logger.log(logType.fail, `Failed to connect to database ${dbType}`);
      throw err;
    }

  }
}
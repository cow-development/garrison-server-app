import ErrorHandler from '../../../config/models/error/error-handler.model';

import { ELogType as logType } from '../../../config/models/log/log.model';
import IMonitored from '../../../config/models/IMonitored';
import MonitoringService from '../../../config/services/monitoring/monitoring.service'

import { ObjectId } from 'mongodb';

import { IBuilding, IBuildingCost, IRequiredBuilding } from '../../../config/models/data/static/building/building.types';
import IBuildingConstructionCancel from '../../../config/models/data/dynamic/garrison/payloads/IBuildingConstructionCancel';
import IBuildingCreate from '../../../config/models/data/dynamic/garrison/payloads/IBuildingCreate';
import IBuildingUpgradeOrExtend from '../../../config/models/data/dynamic/garrison/payloads/IBuildingUpgradeOrExtend';

import { IBuildingImprovementType, IGarrison, IGarrisonBuilding, IGarrisonDocument, IGarrisonModel, IGarrisonResources, IGarrisonUnit, IOperatedConstruction } from '../../../config/models/data/dynamic/garrison/garrison.types';
import IGarrisonCreate from '../../../config/models/data/dynamic/garrison/payloads/IGarrisonCreate';

import { IUnit, IUnitCost } from '../../../config/models/data/static/unit/unit.types';
import IUnitAssign from '../../../config/models/data/dynamic/garrison/payloads/IUnitAssign';
import IUnitCreate from '../../../config/models/data/dynamic/garrison/payloads/IUnitCreate';
import IUnitUnassign from '../../../config/models/data/dynamic/garrison/payloads/IUnitUnassign';

import { IZone } from '../../../config/models/data/static/zone/zone.types'

import BuildingRepository from '../../static/building.repo';
import CharacterRepository from '../character/character.repo';
import UnitRepository from '../../static/unit.repo';
import UserRepository from '../user/user.repo';
import ZoneRepository from '../../static/zone.repo';

import _h from '../../../utils/helper.utils';
import { IStaticEntityCost } from '../../../config/models/data/static/static.types';

import _gH from './utils/helper.utils.garrison.repo';

export default class GarrisonRepository implements IMonitored {
  private _monitor = new MonitoringService(this.constructor.name);
  
  /** Retrieve class monitoring service. */
  get monitor() {
    return this._monitor;
  }

  constructor(
    private _model: IGarrisonModel,
    private _buildingRepo: BuildingRepository,
    private _characterRepo: CharacterRepository,
    private _unitRepo: UnitRepository,
    private _userRepo: UserRepository,
    private _zoneRepo: ZoneRepository
  ) {
    this._monitor.log(logType.pass, 'Initialized garrison repository');
  }

  /**
   * Find a garrison by its id.
   * @param id Given ObjectId.
   * @param strict Sets whether an error is thrown when no garrison is found.
   * @returns Either an IGarrisonDocument or (maybe) null if strict mode is set to false.
   */
  async findById(id: ObjectId, strict?: true): Promise<IGarrisonDocument>;
  async findById(id: ObjectId, strict: false): Promise<IGarrisonDocument | null>;
  async findById(id: ObjectId, strict?: boolean) {
    const result = await this._model.findById(id);
    if (!result && strict) throw new ErrorHandler(404, `Garrison with garrisonId '${id}' couldn't be found.`);

    return result;
  }

  /**
   * Get a garrison from a user's id.
   * @param userId Given ObjectId.
   * @param strict Sets whether an error is thrown when no garrison is found.
   * @returns Either an IGarrisonDocument or (maybe) null if strict mode is set to false.
   */
  async getFromUser(userId: ObjectId, strict?: true): Promise<IGarrisonDocument>;
  async getFromUser(userId: ObjectId, strict: false): Promise<IGarrisonDocument | null>;
  async getFromUser(userId: ObjectId, strict?: boolean) {
    const user = await this._userRepo.findById(userId);
    const character = await this._characterRepo.getFromUser(user?._id);

    const result = await this.getFromCharacter(character?._id);
    if (!result && strict) throw new ErrorHandler(404, `Garrison from userId '${userId}' couldn't be found.`);

    return result;
  }

  /**
   * Get a garrison from a character's id.
   * @param userId Given ObjectId.
   * @param strict Sets whether an error is thrown when no garrison is found.
   * @returns Either an IGarrisonDocument or (maybe) null if strict mode is set to false.
   */
  async getFromCharacter(characterId: ObjectId, strict?: true): Promise<IGarrisonDocument>;
  async getFromCharacter(characterId: ObjectId, strict: false): Promise<IGarrisonDocument | null>;
  async getFromCharacter(characterId: ObjectId, strict?: boolean) {
    const result = await this._model.findOne({ characterId });
    if (!result && strict) throw new ErrorHandler(404, `Garrison from characterId '${characterId}' couldn't be found.`);

    return result;
  }

  /**
   * Create and save a new garrison in database.
   * @param payload @see IGarrisonCreate
   */
  async create(payload: IGarrisonCreate) {
    const characterGarrison = await this.getFromCharacter(payload.characterId, false);
    if (characterGarrison && _h.areSameString(characterGarrison.name, payload.name)) {
      throw new ErrorHandler(409, `Already existing garrison with name '${payload.name}'.`);
    }

    const character = await this._characterRepo.findById(payload.characterId);
    const zone = await this._zoneRepo.findByCode(payload.zone) as IZone;

    // check if given zone is compliant with character's faction
    if (!_h.areSameString(zone.side, character?.side.faction || ''))
      throw new ErrorHandler(400, `Selected zone (${payload.zone}) is not compliant with character\`s faction (${character?.side.faction}).`);

    // create the garrison with default values
    return await this._model.create({
      characterId: payload.characterId,
      name: payload.name,
      zone: payload.zone,
      resources: {
        gold: 625,
        wood: 320,
        food: 3,
        plot: 32
      },
      instances: {
        buildings: [],
        researches: [],
        units: [
          {
            code: 'peasant',
            quantity: 3,
            state: {
              assignments: []
            }
          }
        ]
      }
    });
  }
  
  /**
   * Add and save a new building.
   * @param payload @see IBuildingCreate
   */
  async addBuilding(payload: IBuildingCreate) {
    // ⌚ init the moment
    const now = new Date();

    //////////////////////////////////////////////

    // ❔ make the checks
    const garrison = await this.findById(payload.garrisonId);
    const staticBuilding = await this._buildingRepo.findByCode(payload.code) as IBuilding;

    const { unit: peasants } = _gH.findUnit(garrison, 'peasant');
    _gH.checkWorkforceCoherence(
      now,
      payload.workforce,
      peasants,
      staticBuilding
    );

    const { requiredEntities } = staticBuilding.instantiation;
    if (requiredEntities) {
      _gH.checkConstructionRequirements(
        now,
        requiredEntities.buildings,
        garrison.instances.buildings
      );
    }

    //////////////////////////////////////////////

    // 🔨 prepare to build! 
    const { duration } = _gH
      .computeConstructionDurationAndWorkforce(
        payload.workforce,
        staticBuilding
      );

    const construction: IOperatedConstruction = {
      _id: new ObjectId(),
      beginDate: now,
      endDate: _h.addTime(now, duration * 1000),
      workforce: payload.workforce
    };
    
    const buildingId = new ObjectId();
    garrison.instances.buildings = [
      ...garrison.instances.buildings,
      {
        _id: buildingId,
        code: payload.code,
        constructions: [construction]
      }
    ];

    //////////////////////////////////////////////

    // 💰 update the resources
    garrison.resources = (await this.updateResources(garrison)).resources;
    garrison.resources = _gH
      .checkConstructionPaymentCapacity(
        now,
        garrison.resources,
        staticBuilding.instantiation.cost
      );
      
    // 💰 "gift-harvest" type of buildings directly give their resource here,
    if (staticBuilding.harvest && !staticBuilding.harvest.maxWorkforce)
      garrison.resources[staticBuilding.harvest.resource] += staticBuilding.harvest.amount;
    
    // 👨‍💼 assign peasants to building-site
    peasants.state.assignments = [
      ...peasants.state.assignments,
      {
        _id: new ObjectId(),
        buildingId,
        quantity: payload.workforce,
        type: 'construction',
        endDate: _h.addTime(now, duration * 1000)
      }
    ];

    //////////////////////////////////////////////

    // 💾 save in database
    garrison.markModified('instances.buildings');
    garrison.markModified('instances.units');
    await garrison.save();
    
    return await this.findById(garrison._id);
  }

  /**
   * Cancel an ongoing building construction.
   * @param payload @see IBuildingConstructionCancel
   */
  async cancelBuildingConstruction(payload: IBuildingConstructionCancel) {
    // ❔ make the checks
    const garrison = await this.findById(payload.garrisonId);
    const { building, index: bIndex } = _gH.findBuilding(garrison, payload.buildingId);
    const staticBuilding = await this._buildingRepo.findByCode(building.code) as IBuilding;

    const { index: cIndex } = _gH
      .findBuildingConstruction(
        building,
        payload.constructionId
      );

    //////////////////////////////////////////////

    // 💰 prepare to refund!
    let { gold, wood, plot } = staticBuilding.instantiation.cost;
    
    const { improvement } = building.constructions[cIndex];
    if (improvement) {
      gold = gold * Math.pow(_gH.getFactor('default'), improvement.level);
      gold = wood * Math.pow(_gH.getFactor('default'), improvement.level);
      gold = plot * Math.pow(_gH.getFactor('decreased'), improvement.level);

      building
        .constructions
        .splice(cIndex, 1);
    } else {
      garrison
        .instances
        .buildings
        .splice(bIndex, 1);
    }

    garrison.resources = {
      ...garrison.resources,
      gold: garrison.resources.gold + gold,
      wood: garrison.resources.wood + wood,
      plot: garrison.resources.plot + plot,
    };

    const { harvest, code } = staticBuilding;
    if (harvest) {
      const checkBuildingStillExists = (buildings: IGarrisonBuilding[], code: string) => {
        return buildings
          .some(b => b.code === code);
      };
      
      switch (typeof harvest.maxWorkforce) {
        case 'number':
          if (checkBuildingStillExists(garrison.instances.buildings, code))
            delete garrison.resources[`${harvest.resource}LastUpdate` as 'goldLastUpdate' | 'woodLastUpdate'];
          break;

        case undefined:
          const owed = Math.floor(
            harvest.amount * Math.pow(_gH.getFactor('decreased'), improvement?.level || 1)
          );
          const rest = garrison.resources[harvest.resource] - owed;
          garrison.resources[harvest.resource] = rest >= 0 ? rest : 0;
          break;
      }
    }

    //////////////////////////////////////////////

    // 👨‍💼 unassign peasants from building-site
    const { unit: peasants } = _gH.findUnit(garrison, 'peasant');
    const aIndex = peasants
      .state
      .assignments
      .findIndex(a => a.endDate.getTime() === building.constructions[cIndex]?.endDate.getTime());

    peasants
      .state
      .assignments
      .splice(aIndex, 1);

    //////////////////////////////////////////////

    // 💾 save in database
    garrison.markModified('instances.buildings');
    garrison.markModified('instances.units');
    await garrison.save();

    return await this.findById(garrison._id);
  }

  /**
   * Upgrade and save an existing building.
   * @param payload @see IBuildingUpgradeOrExtend
   */
  async upgradeBuilding(payload: IBuildingUpgradeOrExtend) {
    // ⌚ init the moment
    const now = new Date();

    //////////////////////////////////////////////

    // ❔ make the checks
    const garrison = await this.findById(payload.garrisonId);
    const { building } = _gH.findBuilding(garrison, payload.buildingId);
    const staticBuilding = await this._buildingRepo.findByCode(building.code) as IBuilding;

    _gH.checkBuildingAvailability(now, building);

    const { nextUpgrade } = _gH
      .checkBuildingImprovable(
        now,
        building,
        staticBuilding,
        'upgrade'
      );

    const { requiredEntities } = nextUpgrade;
    if (requiredEntities) {
      _gH.checkConstructionRequirements(
        now,
        requiredEntities.buildings,
        garrison.instances.buildings
      );
    }
      
    const { duration } = _gH
      .computeConstructionDurationAndWorkforce(
        payload.workforce,
        staticBuilding,
        nextUpgrade.level
      );

    const { unit: peasants } = _gH.findUnit(garrison, 'peasant');
    _gH.checkWorkforceCoherence(
      now,
      payload.workforce,
      peasants,
      staticBuilding,
      'upgrade',
      building.constructions
    );

    //////////////////////////////////////////////
    
    // 🔨 prepare to build! 
    const construction: IOperatedConstruction = {
      _id: new ObjectId(),
      beginDate: now,
      endDate: _h.addTime(now, duration * 1000),
      workforce: payload.workforce,
      improvement: {
        type: 'upgrade',
        level: nextUpgrade.level
      }
    };

    building.constructions = [
      ...building.constructions,
      construction
    ];

    //////////////////////////////////////////////

    // 💰 update the resources
    garrison.resources = (await this.updateResources(garrison)).resources;
    garrison.resources = _gH
      .checkConstructionPaymentCapacity(
        now,
        garrison.resources,
        staticBuilding.instantiation.cost,
        'upgrade',
        building.constructions
      );
      
    // 💰 "gift-harvest" type of buildings directly give their resource here,
    if (staticBuilding.harvest && !staticBuilding.harvest.maxWorkforce)
      garrison.resources[staticBuilding.harvest.resource] += Math.floor(
        staticBuilding.harvest.amount * Math.pow(1.2, nextUpgrade.level)
      );

    //////////////////////////////////////////////
  
    // 👨‍💼 assign peasants to building-site
    peasants.state.assignments = [
      ...peasants.state.assignments,
      {
        _id: new ObjectId(),
        buildingId: <ObjectId>building._id,
        quantity: payload.workforce,
        type: 'construction',
        endDate: _h.addTime(now, duration * 1000)
      }
    ];

    //////////////////////////////////////////////

    // 💾 save in database
    garrison.markModified('instances.buildings');
    garrison.markModified('instances.units');
    await garrison.save();
    
    return await this.findById(garrison._id);
  }

  async extendBuilding(payload: IBuildingUpgradeOrExtend) {
    // init the moment
    const now = new Date();
    
    // check on garrison existence
    const garrison = await this.findById(payload.garrisonId);
    if (!garrison) throw new ErrorHandler(404, `Garrison '${payload.garrisonId}' couldn\'t be found.`);

    const { building: garrBuilding } = _gH.findBuilding(garrison, payload.buildingId);
    if (!garrBuilding) throw new ErrorHandler(404, `Building '${payload.buildingId}' couldn't be found in garrison.`);
    
    // check on building existence
    const building = await this._buildingRepo.findByCode(garrBuilding.code) as IBuilding;
    if (!building) throw new ErrorHandler(404, 'Building couldn\'t be found.');

    // check on building extension existence
    if (!building.extension)
      throw new ErrorHandler(412, `Building '${building.code}' cannot be extended.`);

    // check on building availability
    const unavailableBuilding = garrBuilding
      .constructions
      .some(c => c.endDate.getTime() > now.getTime());
    if (unavailableBuilding) throw new ErrorHandler(412, `Building '${payload.buildingId}' is already being processed.`);

    // check on current building extension level
    const currentLevel = garrBuilding
      .constructions
      .filter(c => c.improvement?.type === 'extension')
      .map(c => <number>c.improvement?.level)
      .reduce((prev, next) => next > prev ? next : prev, 0);

    // check on upgrade possibility
    if ((currentLevel + 1) > <number>building.extension.maxLevel)
      throw new ErrorHandler(400, `No extension is available at this level (${currentLevel}).`);

    // check on upgrade requirements
    const unfulfilled = building.extension.requiredEntities?.buildings.some(b => {
      // look for the building in garrison
      const existing = garrison.instances.buildings.find(gB => gB.code === b.code);
      if (!existing) return true;

      if (b.upgradeLevel && (b.level === currentLevel + 1)) {
        // is the building at the required upgrade level ?
        const upgraded = existing.constructions.find(c => <number>c.improvement?.level >= <number>b.upgradeLevel);
        if (!upgraded) return true;

        // is the building still being processed for this specific upgrade ?
        if (upgraded.endDate.getTime() > now.getTime()) return true;
      }

      // is the building still being processed for its instantiation ?
      const unavailable = existing.constructions.some(c => !c.improvement && (c.endDate.getTime() > now.getTime()));
      if (unavailable) return true;
    });
    if (unfulfilled) throw new ErrorHandler(412, 'Garrison does not fulfill extension requirements.');

    // retrieve and increase both duration and minWorkforce according to current extension level
    let { duration, minWorkforce } = building.instantiation;
    duration = Math.round(duration * Math.pow(1.3, currentLevel + 1));
    minWorkforce = minWorkforce * Math.pow(2, currentLevel + 1);

    const { unit: peasants } = _gH.findUnit(garrison, 'peasant');
    if (!peasants) throw new ErrorHandler(404, 'Not a single peasant could be found.');
    if (payload.workforce > peasants.quantity) throw new ErrorHandler(400, 'Given workforce cannot be greater than current peasant quantity.');
    
    // check on peasants availability
    const unavailablePeasants = peasants
      .state
      .assignments
      .filter(a => a.endDate.getTime() > now.getTime())
      .map(a => a.quantity)
      .reduce((prev, next) => prev + next, 0);
    if ((payload.workforce > (peasants.quantity - unavailablePeasants))) throw new ErrorHandler(412, 'Not enough available peasants.');

    if (payload.workforce < minWorkforce) throw new ErrorHandler(400, 'Given workforce is not enough.');

    if (payload.workforce > minWorkforce * 2)
      throw new ErrorHandler(400, 'A build-site cannot rally more than the double of minimum required workforce.');
    
    // apply bonus: each additionnal worker reduces duration by 3%
    const newDuration = duration * Math.pow(0.97, payload.workforce - minWorkforce);
    duration = Math.floor(newDuration);

    // operate building upgrade
    const constructed: IOperatedConstruction = {
      _id: new ObjectId(),
      beginDate: now,
      endDate: _h.addTime(now, newDuration * 1000),
      workforce: payload.workforce,
      improvement: {
        type: 'extension',
        level: currentLevel + 1
      }
    };

    garrison.instances.buildings = garrison
      .instances
      .buildings
      .map(b => {
        if (b.code === building.code) {
          b.constructions = [
            ...b.constructions,
            constructed
          ]
        }
        return b;
      });

    const goldCost = Math.round(building.instantiation.cost.gold * Math.pow(1.6, currentLevel + 1));
    const woodCost = Math.round(building.instantiation.cost.wood * Math.pow(1.6, currentLevel + 1));
    const plotCost =  Math.round((building.instantiation.cost.plot / 2) * Math.pow(1.5, currentLevel + 1));
    if (garrison.resources.gold - goldCost < 0
    || garrison.resources.wood - woodCost < 0
    || garrison.resources.plot - plotCost < 0)
      throw new ErrorHandler(412, 'Not enough resources.');
    
    garrison.resources = {
      ...garrison.resources,
      gold: garrison.resources.gold - goldCost,
      wood: garrison.resources.wood - woodCost,
      plot: garrison.resources.plot - plotCost
    }

    if (building.harvest && !building.harvest.maxWorkforce)
      garrison.resources[building.harvest.resource] += Math.floor(
        building.harvest.amount * Math.pow(1.2, currentLevel + 1)
      );
    
    // assign rallied workforce to their occupation
    peasants.state.assignments = [
      ...peasants.state.assignments,
      {
        _id: new ObjectId(),
        buildingId: <ObjectId>garrBuilding._id,
        quantity: payload.workforce,
        type: 'construction',
        endDate: _h.addTime(now, newDuration * 1000)
      }
    ];

    // mark modified elements then save in database
    garrison.markModified('instances.buildings');
    garrison.markModified('instances.units');
    await garrison.save();
    
    return await this.findById(garrison._id);
  }

  async addUnit(payload: IUnitCreate) {
    // init the moment
    const now = new Date();
    
    // check on garrison existence
    const garrison = await this.findById(payload.garrisonId);
    if (!garrison) throw new ErrorHandler(404, `Garrison ${payload.garrisonId} couldn't be found.`);
    
    // check on unit existence
    const unit = await this._unitRepo.findByCode(payload.code) as IUnit;
    if (!unit) throw new ErrorHandler(404, `Unit '${payload.code}' couldn't be found.`);

    // check on instantiation requirements
    const unfulfilled = unit.instantiation.requiredEntities?.buildings.some(b => {
      // look for the building in garrison
      const existing = garrison.instances.buildings.find(gB => gB.code === b.code);
      if (!existing) return true;

      if (b.upgradeLevel) {
        // is the building at the required upgrade level ?
        const upgraded = existing.constructions.find(c => <number>c.improvement?.level >= <number>b.upgradeLevel);
        if (!upgraded) return true;

        // is the building still being processed for this specific upgrade ?
        if (upgraded.endDate.getTime() > now.getTime()) return true;
      }

      // is the building still being processed for its instantiation ?
      const unavailable = existing.constructions.some(c => !c.improvement && (c.endDate.getTime() > now.getTime()));
      if (unavailable) return true;
    });
    if (unfulfilled) throw new ErrorHandler(412, 'Garrison does not fulfill instantiation requirements.');

    // operate unit creation
    const assignments: IGarrison['instances']['units'][any]['state']['assignments'] = [];
    for (let i = 0; i < (payload.quantity || 1); i++) {
      assignments.push({
        quantity: 1,
        type: 'instantiation',
        endDate: _h.addTime(
          assignments[i - 1]?.endDate || now,
          unit.instantiation.duration * 1000
        )
      });
    }

    const newUnit = {
      code: unit.code,
      quantity: payload.quantity || 1,
      state: { assignments }
    };
    
    const index = garrison.instances.units.findIndex(u => u.code === newUnit.code);
    if (index < 0) {
      garrison.instances.units = [
        ...garrison.instances.units,
        newUnit
      ];
    } else {
      garrison.instances.units[index] = {
        code: garrison.instances.units[index].code,
        quantity: garrison.instances.units[index].quantity + newUnit.quantity,
        state: { 
          assignments: garrison
            .instances
            .units[index]
            .state
            .assignments
            .concat(newUnit.state.assignments)
        }
      };
    }

    // automatically update eligible resources
    garrison.resources = (await this.updateResources(garrison)).resources;

    const goldCost = unit.instantiation.cost.gold * newUnit.quantity;
    const woodCost = unit.instantiation.cost.wood * newUnit.quantity;
    const foodCost = unit.instantiation.cost.food * newUnit.quantity;
    if (garrison.resources.gold - goldCost < 0
    || garrison.resources.wood - woodCost < 0
    || garrison.resources.food - foodCost < 0)
      throw new ErrorHandler(412, 'Not enough resources.');

    garrison.resources = {
      ...garrison.resources,
      gold: garrison.resources.gold - goldCost,
      wood: garrison.resources.wood - woodCost,
      food: garrison.resources.food - foodCost
    }

    // mark modified elements then save in database
    garrison.markModified('instances.units');
    await garrison.save();
    
    return await this.findById(garrison._id);
  }

  async assignUnit(payload: IUnitAssign) {
    // init the moment
    const now = new Date();
    
    // check on garrison existence
    const garrison = await this.findById(payload.garrisonId);
    if (!garrison) throw new ErrorHandler(404, `Garrison '${payload.garrisonId}' couldn\'t be found.`);

    // check on building existence in dynamic
    const { building: garrBuilding } = _gH.findBuilding(garrison, payload.buildingId);
    if (!garrBuilding) throw new ErrorHandler(404, `Building '${payload.buildingId}' couldn't be found in garrison.`);
    
    // check on building existence in statics
    const building = await this._buildingRepo.findByCode(garrBuilding.code) as IBuilding;
    if (!building) throw new ErrorHandler(404, `Building '${garrBuilding.code}' couldn't be found.`);

    // handle only harvest building for now...
    if (!building.harvest) throw new ErrorHandler(400, `No peasant can be assigned at building '${building.code}'.`);

    // check on unit(s) existence in statics
    const unit = await this._unitRepo.findByCode(payload.code) as IUnit;
    if (!unit) throw new ErrorHandler(404, `Unit ${payload.code} couldn't be found.`);

    // check on unit(s) existence in dynamic
    const { unit: garrUnits } = _gH.findUnit(garrison, payload.code);
    if (!garrUnits) throw new ErrorHandler(404, `Not a single '${payload.code}' could be found.`);
    if ((payload.quantity || 1) > garrUnits.quantity) throw new ErrorHandler(412, `Given workforce cannot be greater than current '${payload.code}' quantity.`);

    // check on building availability
    const unavailableBuilding = garrBuilding
      .constructions
      .some(c => c.endDate.getTime() > now.getTime());
    if (unavailableBuilding) throw new ErrorHandler(412, `Building '${payload.buildingId}' is already being processed.`);

    // check on unit(s) availability
    const unavailableUnits = garrUnits
      .state
      .assignments
      .filter(a => a.endDate.getTime() > now.getTime())
      .map(a => Number(a.quantity))
      .reduce((prev, next) => prev + next, 0);
    if (((payload.quantity || 1) > (garrUnits.quantity - unavailableUnits))) throw new ErrorHandler(412, `Not enough available '${payload.code}'.`);

    // update garrison resources if assigning one or more peasants
    if (unit.code === 'peasant') {
      garrison.resources = (await this.updateResources(garrison)).resources;
    }

    // assign units to the building
    for (let i = 0; i < (payload.quantity || 1); i++) {
      const index = garrUnits.state.assignments.findIndex(a => (a.buildingId?.toHexString() === garrBuilding._id?.toHexString()) && a.type === 'harvest');
      if (index < 0) {
        garrUnits.state.assignments.push({
          buildingId: garrBuilding._id,
          quantity: 1,
          type: 'harvest',
          endDate: new Date('2099-01-01')
        });
        continue;
      }
      garrUnits.state.assignments[index] = {
        ...garrUnits.state.assignments[index],
        quantity: garrUnits.state.assignments[index].quantity + 1
      };
    }

    // init resource last update if there isn't any
    if (building.harvest) {
      if (building.code === 'goldmine' && !garrison.resources.goldLastUpdate) {
        garrison.resources = {
          ...garrison.resources,
          goldLastUpdate: now
        };
      } else if (building.code === 'sawmill' && !garrison.resources.woodLastUpdate) {
        garrison.resources = {
          ...garrison.resources,
          woodLastUpdate: now
        };
      }
    }

    // mark modified elements then save in database
    garrison.markModified('instances.units');
    await garrison.save();
    
    return await this.findById(garrison._id);
  }

  async unassignUnit(payload: IUnitUnassign) {
    // init the moment
    const now = new Date();
    
    // check on garrison existence
    const garrison = await this.findById(payload.garrisonId);
    if (!garrison) throw new ErrorHandler(404, `Garrison '${payload.garrisonId}' couldn\'t be found.`);

    // check on building existence in dynamic
    const { building: garrBuilding } = _gH.findBuilding(garrison, payload.buildingId);
    if (!garrBuilding) throw new ErrorHandler(404, `Building '${payload.buildingId}' couldn't be found in garrison.`);
    
    // check on building existence in statics
    const building = await this._buildingRepo.findByCode(garrBuilding.code) as IBuilding;
    if (!building) throw new ErrorHandler(404, `Building '${garrBuilding.code}' couldn't be found.`);

    // handle only harvest building for now...
    if (!building.harvest) throw new ErrorHandler(400, `No peasant can be assigned at building '${building.code}'.`);

    // check on unit(s) existence in statics
    const unit = await this._unitRepo.findByCode(payload.code) as IUnit;
    if (!unit) throw new ErrorHandler(404, `Unit ${payload.code} couldn't be found.`);

    // check on unit(s) existence in dynamic
    const { unit: garrUnits } = _gH.findUnit(garrison, payload.code);
    if (!garrUnits) throw new ErrorHandler(404, `Not a single '${payload.code}' could be found.`);
    
    // check on assignment existence
    const index = garrUnits
      .state
      .assignments
      .findIndex(a => {
        if (garrBuilding._id && a.buildingId) {
          const areSame = _h.areSameObjectId(garrBuilding._id, a.buildingId);
          if (areSame && a.type === 'harvest') return a;
        }
      });
    if (index < 0) throw new ErrorHandler(404, 'No assignment could be found.');
    if (garrUnits.state.assignments[index].quantity < (payload.quantity || 1))
      throw new ErrorHandler(412, 'Given quantity cannot be greather than current assigned peasants.');

    // update garrison resources if unassigning one or more peasants
    if (unit.code === 'peasant') {
      garrison.resources = (await this.updateResources(garrison)).resources;
    }

    // unassigning units from the building
    garrUnits.state.assignments[index].quantity = garrUnits.state.assignments[index].quantity - (payload.quantity || 1);
    if (garrUnits.state.assignments[index].quantity === 0) garrUnits.state.assignments.splice(index, 1);

    // update resource last update
    if (building.harvest) {
      if (building.code === 'goldmine') {
        // check if at least 1 worker is assigned to some harvest building
        const noActiveworker = !garrUnits.state.assignments.some(a => {
          return a.type === 'harvest' && garrison
            .instances
            .buildings
            .find(b => b?._id?.equals(a.buildingId || "") && b.code === building.code);
        });
        if (noActiveworker) delete garrison.resources.goldLastUpdate;
      } else if (building.code === 'sawmill') {
        // check if at least 1 worker is assigned to some harvest building
        const noActiveworker = !garrUnits.state.assignments.some(a => {
          return a.type === 'harvest' && garrison
            .instances
            .buildings
            .find(b => b?._id?.equals(a.buildingId || "") && b.code === building.code);
        });
        if (noActiveworker) delete garrison.resources.woodLastUpdate;
      }
    }

    // mark modified elements then save in database
    garrison.markModified('instances.units');
    await garrison.save();
    
    return await this.findById(garrison._id);
  }

  private async updateResources(garrison: IGarrison) {
    // init the moment
    const now = new Date();

    for (const building of garrison.instances.buildings) {
      // retrieve matching building from database static
      const matchStatics = await this._buildingRepo.findByCode(building.code) as IBuilding;
      if (!matchStatics.harvest) continue;

      // check on building availability
      const unavailable = building
        .constructions
        .some(c => c.endDate.getTime() > now.getTime());
      if (unavailable) continue;

      // calculate assigned workers
      const assignedWorkers = garrison
        .instances
        .units
        .find(unit => unit.code === 'peasant')
        ?.state
        .assignments
        .find(assignment => {
          if (assignment.type !== 'harvest' || !assignment.buildingId || !building._id) return;

          const buildingId = new ObjectId(assignment.buildingId);
          if (buildingId.equals(building._id)) return assignment;
        })
        ?.quantity;
      if (!assignedWorkers || assignedWorkers == 0) continue;

      // calculate elapsed time since last resource automatic update
      let elapsedMinutes = 0;
      let goldNewLastUpdate;
      let woodNewLastUpdate;
      if (building.code === 'goldmine') {
        if (!garrison.resources.goldLastUpdate) continue;
        elapsedMinutes = (now.getTime() - garrison.resources.goldLastUpdate.getTime()) / 1000 / 60;
        goldNewLastUpdate = now;
      } else if (building.code === 'sawmill') {
        if (!garrison.resources.woodLastUpdate) continue;
        elapsedMinutes = (now.getTime() - garrison.resources.woodLastUpdate.getTime()) / 1000 / 60;
        woodNewLastUpdate = now;
      }
      if (elapsedMinutes === 0) continue;

      // calculate gained resource according to elapsed minutes
      let newResources = garrison.resources[matchStatics.harvest?.resource] + Math.floor(
        (matchStatics.harvest.amount * elapsedMinutes) * assignedWorkers
      );

      garrison.resources = {
        ...garrison.resources,
        [matchStatics.harvest?.resource]: newResources,
        goldLastUpdate: goldNewLastUpdate || garrison.resources.goldLastUpdate,
        woodLastUpdate: woodNewLastUpdate || garrison.resources.woodLastUpdate
      };
    }
    return garrison;
  }
}
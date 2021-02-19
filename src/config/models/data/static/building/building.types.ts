import { Document, Model } from 'mongoose';

import { IStaticEntity, IStaticEntityCost, IStaticEntityStatics } from '../static.types';

/**
 * Represents a standard Building Document from database.
 * Includes both IBuilding and Document own fields.
 */
export interface IBuildingDocument extends IBuilding, Document {}

/**
 * Represents a standard Building mongoose model.
 * Contains documents of type IBuildingDocument.
 */
export interface IBuildingModel extends Model<IBuildingDocument>, IStaticEntityStatics {}

/**
 * The representation of a building.
 */
export interface IBuilding extends IStaticEntity {
  /** Instantiation requirements and characteristics. */
  instantiation: {
    cost: IBuildingCost;
    minWorkforce: number;
    duration: number;
    requiredEntities?: {
      buildings: IRequiredBuilding[];
    }
  };
  
  /** Upgrades list. */
  upgrades?: {
    level: number;
    word: string | {
      side: string;
      jargon: string;
    }[];
    requiredEntities?: {
      buildings: IRequiredBuilding[];
    }
  }[];
  
  /** Extension characteristics. */
  extension?: {
    /** Requirements. */
    requiredEntities?: {
      buildings: IRequiredBuildingForExtensionLevel[];
    }
    
    /** Maximum extension level. */
    maxLevel?: number;
  };
  
  /** Building type(s) characteristics. */
  harvest?: {
    /** Which resource is this building harvesting (gold, wood, food) ? */
    resource: 'gold' | 'wood' | 'plot' | 'food';

    /**
     * Either the amount of resource this building is giving when it gets constructed,
     * or the amount of resource this building is giving every *t* time for 1 worker
     * (it depends whether maxWorkforce property is included or not).
     */
    amount: number;

    /** Maximum workforce on harvesting in this building. */
    maxWorkforce?: number;
  }
  // ... implement other types: production, research, military
}

/** A building that can be required to build, extend or upgrade another building, or train a unit. */
export interface IRequiredBuilding {
  /** The unique identifier of the required building. */
  code: string;
  
  /** The required upgrade level of the required building. */
  upgradeLevel?: number;
}

/** 
 * The extension level at which it is required to build the much-vauted required buildings.
 * */
interface IRequiredBuildingForExtensionLevel extends IRequiredBuilding {
  /** The extension level at which the building(s) is/are required. */
  level: number;
}

/**
 * The cost of instantiating, upgrading or extending a building.
 */
interface IBuildingCost extends IStaticEntityCost {
  /** Cost in plot. */
  plot: number;
}
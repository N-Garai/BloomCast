"""SQLite persistence for citizen observations, alert subscriptions, and influence logs."""
import json
import os
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import create_engine, Column, Integer, String, Float, Text, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker

from shared.config import DATABASE_URL

Base = declarative_base()


class CitizenObservation(Base):
    __tablename__ = "citizen_observations"
    id = Column(Integer, primary_key=True)
    observation_id = Column(String, unique=True, index=True)
    waterbody_id = Column(String, index=True)
    observer_id = Column(String, nullable=True)
    observed_at = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    water_color = Column(String)
    scum_visible = Column(Boolean, default=False)
    odor = Column(String, default="none")
    wildlife_dead = Column(Boolean, default=False)
    photo_url = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    source = Column(String, default="bloomcast-form")
    validation_status = Column(String, default="pending")
    validated_by = Column(String, nullable=True)
    validated_at = Column(String, nullable=True)


class AlertSubscription(Base):
    __tablename__ = "alert_subscriptions"
    id = Column(Integer, primary_key=True)
    email = Column(String, index=True)
    waterbody_id = Column(String, index=True)
    threshold = Column(Float, default=0.6)
    horizon_days = Column(Integer, default=5)
    fhir_export_consent = Column(Boolean, default=False)
    unsubscribe_token = Column(String, unique=True)
    created_at = Column(String, default=lambda: datetime.now(timezone.utc).isoformat())


class ForecastInfluenceLog(Base):
    __tablename__ = "forecast_influence_log"
    id = Column(Integer, primary_key=True)
    waterbody_id = Column(String, index=True)
    forecast_date = Column(String)
    prior_probability = Column(Float)
    new_probability = Column(Float)
    probability_delta = Column(Float)
    contributing_observations = Column(Text)
    contributor_user_ids = Column(Text, nullable=True)
    created_at = Column(String, default=lambda: datetime.now(timezone.utc).isoformat())


def _connect():
    if DATABASE_URL.startswith("sqlite"):
        db_path = DATABASE_URL.replace("sqlite:///", "")
        if db_path.startswith("./"):
            db_path = os.path.join(os.getcwd(), db_path.replace("./", ""))
        elif db_path == ":memory:":
            db_path = ":memory:"
        engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    else:
        engine = create_engine(DATABASE_URL)
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine)


_engine, _Session = _connect()


def get_session():
    return _Session()


def insert_observation(obs: dict) -> str:
    with get_session() as s:
        row = CitizenObservation(
            observation_id=obs["observation_id"],
            waterbody_id=obs["waterbody_id"],
            observer_id=obs.get("observer_id"),
            observed_at=obs["observed_at"],
            latitude=obs["latitude"],
            longitude=obs["longitude"],
            water_color=obs["water_color"],
            scum_visible=obs.get("scum_visible", False),
            odor=obs.get("odor", "none"),
            wildlife_dead=obs.get("wildlife_dead", False),
            photo_url=obs.get("photo_url"),
            notes=obs.get("notes"),
            source=obs.get("source", "bloomcast-form"),
            validation_status="pending",
        )
        s.add(row)
        s.commit()
        return row.observation_id


def list_observations(wb_id: str | None = None, limit: int = 20) -> list:
    with get_session() as s:
        q = s.query(CitizenObservation)
        if wb_id:
            q = q.filter(CitizenObservation.waterbody_id == wb_id)
        rows = q.order_by(CitizenObservation.observed_at.desc()).limit(limit).all()
        return [
            {
                "observation_id": r.observation_id,
                "waterbody_id": r.waterbody_id,
                "observed_at": r.observed_at,
                "water_color": r.water_color,
                "scum_visible": r.scum_visible,
                "odor": r.odor,
                "wildlife_dead": r.wildlife_dead,
                "source": r.source,
                "validation_status": r.validation_status,
            }
            for r in rows
        ]


def subscribe(body: dict) -> str:
    import uuid
    token = str(uuid.uuid4())
    with get_session() as s:
        s.add(AlertSubscription(
            email=body["email"],
            waterbody_id=body["waterbody_id"],
            threshold=body.get("threshold", 0.6),
            horizon_days=body.get("horizon_days", 5),
            fhir_export_consent=bool(body.get("fhir_export_consent", False)),
            unsubscribe_token=token,
        ))
        s.commit()
    return token


def record_influence(wb_id: str, prior: float, new: float, obs_ids: list, contributors: list) -> None:
    with get_session() as s:
        s.add(ForecastInfluenceLog(
            waterbody_id=wb_id,
            forecast_date=datetime.now(timezone.utc).isoformat(),
            prior_probability=prior,
            new_probability=new,
            probability_delta=new - prior,
            contributing_observations=json.dumps(obs_ids),
            contributor_user_ids=json.dumps(contributors),
        ))
        s.commit()
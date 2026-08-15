from backend.database import Base, engine
from backend import models

print("Creating Aqua AI database tables...")

Base.metadata.create_all(bind=engine)

print("SUCCESS: Tables created!")

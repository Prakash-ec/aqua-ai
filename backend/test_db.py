from database import engine

try:
    with engine.connect():
        print("SUCCESS: Connected to PostgreSQL!")
        print("Database: aqua_ai")
except Exception as e:
    print("DATABASE CONNECTION FAILED")
    print(e)

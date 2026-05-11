import sqlite3

def init_db():
    conn = sqlite3.connect('walkability.db')
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            location TEXT,
            sidewalk_width INTEGER,
            pavement_quality INTEGER,
            greenery INTEGER,
            traffic_safety INTEGER,
            air_quality INTEGER,
            total_score INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def insert_feedback(data):
    conn = sqlite3.connect('walkability.db')
    c = conn.cursor()
    c.execute('''
        INSERT INTO feedback (location, sidewalk_width, pavement_quality, greenery, traffic_safety, air_quality, total_score)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['location'],
        data['sidewalk_width'],
        data['pavement_quality'],
        data['greenery'],
        data['traffic_safety'],
        data['air_quality'],
        data['total_score']
    ))
    conn.commit()
    conn.close()

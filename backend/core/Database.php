<?php
/**
 * Database.php — Connexion PDO à MariaDB, en pattern Singleton.
 *
 * Pourquoi un Singleton ? Pour garantir UNE SEULE connexion PDO partagée
 * pendant toute la durée d'une requête HTTP, au lieu d'en rouvrir une à
 * chaque appel. On y accède partout via Database::getInstance().
 */
class Database
{
    /** @var Database|null L'unique instance de la classe. */
    private static ?Database $instance = null;

    /** @var PDO La connexion PDO réelle. */
    private PDO $pdo;

    /**
     * Constructeur PRIVÉ : on ne peut pas faire "new Database()" de l'extérieur.
     * C'est ce qui force à passer par getInstance().
     */
    private function __construct()
    {
        // Identifiants lus dans les variables d'environnement injectées par
        // Docker (cf. docker-compose.yml -> service web -> environment).
        // Les valeurs ":? ... ?:" servent de filet de sécurité en local.
        $host = getenv('DB_HOST') ?: 'db';
        $name = getenv('DB_NAME') ?: 'os_perso';
        $user = getenv('DB_USER') ?: 'os_user';
        $pass = getenv('DB_PASSWORD') ?: '';

        // charset=utf8mb4 => support complet de l'unicode (accents, emojis).
        $dsn = "mysql:host={$host};dbname={$name};charset=utf8mb4";

        $options = [
            // Lève une exception en cas d'erreur SQL (au lieu d'un warning muet).
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            // Les résultats sont renvoyés sous forme de tableaux associatifs.
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Vraies requêtes préparées côté serveur (sécurité accrue).
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];

        $this->pdo = new PDO($dsn, $user, $pass, $options);
    }

    /**
     * Point d'accès unique à l'instance (la crée au premier appel).
     */
    public static function getInstance(): Database
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Donne accès à l'objet PDO brut, si besoin d'un contrôle fin
     * (transactions, lastInsertId, etc.).
     */
    public function getConnection(): PDO
    {
        return $this->pdo;
    }

    /**
     * Helper : exécute une requête PRÉPARÉE et renvoie le PDOStatement.
     * Toujours passer les valeurs via $params (jamais de concaténation SQL)
     * pour se protéger des injections.
     *
     * Exemple :
     *   $stmt = Database::getInstance()->query(
     *       "SELECT * FROM users WHERE id = :id", [':id' => 5]
     *   );
     *   $user = $stmt->fetch();
     *
     * @param string $sql    La requête, avec des placeholders (:nom ou ?).
     * @param array  $params Les valeurs à lier.
     */
    public function query(string $sql, array $params = []): PDOStatement
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    // --- Garde-fous du pattern Singleton ---

    /** Interdit le clonage (empêche $b = clone $a). */
    private function __clone() {}

    /** Interdit la désérialisation (empêche de recréer une instance). */
    public function __wakeup()
    {
        throw new Exception("Database est un Singleton : désérialisation interdite.");
    }
}

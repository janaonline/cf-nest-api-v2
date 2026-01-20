import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;

  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUsersService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create()', () => {
    it('should create a new user', async () => {
      const createUserDto: CreateUserDto = {
        email: 'newuser@example.com',
        name: 'New User',
        password: 'password123',
      };

      mockUsersService.create.mockResolvedValue(mockUser);

      const result = await controller.create(createUserDto);

      expect(result).toEqual(mockUser);
      expect(mockUsersService.create).toHaveBeenCalledWith(createUserDto);
      expect(mockUsersService.create).toHaveBeenCalledTimes(1);
    });

    it('should handle create errors', async () => {
      const createUserDto: CreateUserDto = {
        email: 'newuser@example.com',
        name: 'New User',
        password: 'password123',
      };

      const error = new Error('User already exists');
      mockUsersService.create.mockRejectedValue(error);

      await expect(controller.create(createUserDto)).rejects.toThrow('User already exists');
      expect(mockUsersService.create).toHaveBeenCalledWith(createUserDto);
    });

    it('should validate required fields', async () => {
      const createUserDto: CreateUserDto = {
        email: 'newuser@example.com',
        name: 'New User',
        password: '',
      };

      mockUsersService.create.mockRejectedValue(new Error('Password is required'));

      await expect(controller.create(createUserDto)).rejects.toThrow('Password is required');
    });
  });

  describe('findAll()', () => {
    it('should return an array of users', async () => {
      const users = [mockUser, { ...mockUser, _id: '507f1f77bcf86cd799439012' }];

      mockUsersService.findAll.mockResolvedValue(users);

      const result = await controller.findAll();

      expect(result).toEqual(users);
      expect(mockUsersService.findAll).toHaveBeenCalledTimes(1);
    });

    it('should return an empty array if no users exist', async () => {
      mockUsersService.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toEqual([]);
      expect(mockUsersService.findAll).toHaveBeenCalledTimes(1);
    });

    it('should handle service errors', async () => {
      const error = new Error('Database connection failed');
      mockUsersService.findAll.mockRejectedValue(error);

      await expect(controller.findAll()).rejects.toThrow('Database connection failed');
    });
  });

  describe('findOne()', () => {
    it('should return a single user by id', async () => {
      const userId = '507f1f77bcf86cd799439011';

      mockUsersService.findOne.mockResolvedValue(mockUser);

      const result = await controller.findOne(userId);

      expect(result).toEqual(mockUser);
      expect(mockUsersService.findOne).toHaveBeenCalledWith(userId);
      expect(mockUsersService.findOne).toHaveBeenCalledTimes(1);
    });

    it('should return null for non-existent user', async () => {
      const userId = '507f1f77bcf86cd799439999';

      mockUsersService.findOne.mockResolvedValue(null);

      const result = await controller.findOne(userId);

      expect(result).toBeNull();
      expect(mockUsersService.findOne).toHaveBeenCalledWith(userId);
    });

    it('should handle invalid id format', async () => {
      const userId = 'invalid-id';

      mockUsersService.findOne.mockRejectedValue(new Error('Invalid user ID'));

      await expect(controller.findOne(userId)).rejects.toThrow('Invalid user ID');
    });

    it('should handle database errors', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const error = new Error('Database query failed');

      mockUsersService.findOne.mockRejectedValue(error);

      await expect(controller.findOne(userId)).rejects.toThrow('Database query failed');
    });
  });

  describe('update()', () => {
    it('should update a user by id', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const updateUserDto: UpdateUserDto = {
        name: 'Updated User',
        email: 'updated@example.com',
      };

      const updatedUser = { ...mockUser, ...updateUserDto };
      mockUsersService.update.mockResolvedValue(updatedUser);

      const result = await controller.update(userId, updateUserDto);

      expect(result).toEqual(updatedUser);
      expect(mockUsersService.update).toHaveBeenCalledWith(userId, updateUserDto);
      expect(mockUsersService.update).toHaveBeenCalledTimes(1);
    });

    it('should handle partial updates', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const updateUserDto: UpdateUserDto = {
        name: 'Updated Name',
      };

      const updatedUser = { ...mockUser, name: 'Updated Name' };
      mockUsersService.update.mockResolvedValue(updatedUser);

      const result = await controller.update(userId, updateUserDto);

      expect(result.name).toEqual('Updated Name');
      expect(mockUsersService.update).toHaveBeenCalledWith(userId, updateUserDto);
    });

    it('should return null for non-existent user', async () => {
      const userId = '507f1f77bcf86cd799439999';
      const updateUserDto: UpdateUserDto = {
        name: 'Updated User',
      };

      mockUsersService.update.mockResolvedValue(null);

      const result = await controller.update(userId, updateUserDto);

      expect(result).toBeNull();
      expect(mockUsersService.update).toHaveBeenCalledWith(userId, updateUserDto);
    });

    it('should handle update errors', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const updateUserDto: UpdateUserDto = {
        email: 'duplicate@example.com',
      };

      mockUsersService.update.mockRejectedValue(new Error('Email already exists'));

      await expect(controller.update(userId, updateUserDto)).rejects.toThrow('Email already exists');
    });

    it('should handle invalid id format', async () => {
      const userId = 'invalid-id';
      const updateUserDto: UpdateUserDto = {
        name: 'Updated User',
      };

      mockUsersService.update.mockRejectedValue(new Error('Invalid user ID'));

      await expect(controller.update(userId, updateUserDto)).rejects.toThrow('Invalid user ID');
    });
  });

  describe('remove()', () => {
    it('should remove a user by id', async () => {
      const userId = '507f1f77bcf86cd799439011';

      mockUsersService.remove.mockResolvedValue(mockUser);

      const result = await controller.remove(userId);

      expect(result).toEqual(mockUser);
      expect(mockUsersService.remove).toHaveBeenCalledWith(userId);
      expect(mockUsersService.remove).toHaveBeenCalledTimes(1);
    });

    it('should return null for non-existent user', async () => {
      const userId = '507f1f77bcf86cd799439999';

      mockUsersService.remove.mockResolvedValue(null);

      const result = await controller.remove(userId);

      expect(result).toBeNull();
      expect(mockUsersService.remove).toHaveBeenCalledWith(userId);
    });

    it('should handle invalid id format', async () => {
      const userId = 'invalid-id';

      mockUsersService.remove.mockRejectedValue(new Error('Invalid user ID'));

      await expect(controller.remove(userId)).rejects.toThrow('Invalid user ID');
    });

    it('should handle deletion errors', async () => {
      const userId = '507f1f77bcf86cd799439011';

      mockUsersService.remove.mockRejectedValue(new Error('Cannot delete user'));

      await expect(controller.remove(userId)).rejects.toThrow('Cannot delete user');
    });
  });
});
